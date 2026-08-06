import type {
  EmbeddingVectorDto,
  NewTopicEmbeddingDto,
  SimilarTopicDto,
  TopicEmbeddingDto,
} from '../dto/embedding.dto.js';
import type { TopicEmbedding as TopicEmbeddingRecord } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import { PersistenceError } from '../types/errors/persistence.error.js';

/** Shape returned by the similarity query. */
interface SimilarityRow {
  readonly topic_id: string;
  readonly title: string;
  readonly similarity: number;
}

/** Shape returned by the insert. */
interface InsertedEmbeddingRow {
  readonly id: string;
  readonly created_at: Date;
}

/**
 * Renders a vector as a pgvector literal, e.g. `[0.1,-0.2]`.
 *
 * Values are validated here because a `NaN` or `Infinity` would produce SQL
 * that fails deep inside the driver with an unhelpful message.
 */
const toVectorLiteral = (vector: EmbeddingVectorDto): string => {
  if (vector.values.length !== vector.dimensions) {
    throw new PersistenceError('Embedding length does not match its declared dimensions.', {
      declared: vector.dimensions,
      actual: vector.values.length,
    });
  }

  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new PersistenceError('Embedding contains a non-finite value.', { model: vector.model });
    }
  }

  return `[${vector.values.join(',')}]`;
};

/** Maps a database row onto the domain DTO. */
const toDto = (record: TopicEmbeddingRecord): TopicEmbeddingDto => ({
  id: record.id,
  topicId: record.topicId,
  model: record.model,
  dimensions: record.dimensions,
  createdAt: record.createdAt,
});

/**
 * Persistence for topic embeddings, the semantic half of duplicate prevention.
 *
 * Tables
 * - `topic_embeddings` (pgvector column `vector`)
 *
 * Methods
 * - {@link save}
 * - {@link findByTopicId}
 * - {@link findSimilar}
 * - {@link deleteByTopicId}
 *
 * This is the one repository that uses raw SQL, and it is the sanctioned
 * exception described in PROJECT_RULES.md: Prisma models a `vector` column as
 * `Unsupported`, so neither writing a vector nor sorting by the `<=>` distance
 * operator is expressible through the query builder. Every statement below is
 * parameterised — no value is ever interpolated into SQL text.
 */
export class EmbeddingRepository {
  constructor(private readonly database: Database) {}

  /**
   * Stores the embedding of a topic, replacing any previous one.
   *
   * @throws {PersistenceError} When the vector is malformed or the write fails.
   */
  public async save(input: NewTopicEmbeddingDto): Promise<TopicEmbeddingDto> {
    const literal = toVectorLiteral(input.vector);

    const rows = await runQuery(
      'EmbeddingRepository.save',
      () =>
        this.database.$queryRaw<InsertedEmbeddingRow[]>`
        INSERT INTO topic_embeddings (id, topic_id, model, dimensions, vector, created_at)
        VALUES (
          gen_random_uuid(),
          ${input.topicId}::uuid,
          ${input.vector.model},
          ${input.vector.dimensions},
          ${literal}::vector,
          now()
        )
        ON CONFLICT (topic_id) DO UPDATE
          SET model = EXCLUDED.model,
              dimensions = EXCLUDED.dimensions,
              vector = EXCLUDED.vector,
              created_at = now()
        RETURNING id, created_at
      `,
    );

    const inserted = rows[0];
    if (inserted === undefined) {
      throw new PersistenceError('Embedding insert returned no row.', { topicId: input.topicId });
    }

    return {
      id: inserted.id,
      topicId: input.topicId,
      model: input.vector.model,
      dimensions: input.vector.dimensions,
      createdAt: inserted.created_at,
    };
  }

  /**
   * Returns the stored embedding metadata for a topic.
   *
   * The vector itself is not returned: nothing outside similarity search needs
   * it, and Prisma cannot select an `Unsupported` column anyway.
   */
  public async findByTopicId(topicId: string): Promise<TopicEmbeddingDto | null> {
    const record = await runQuery('EmbeddingRepository.findByTopicId', () =>
      this.database.topicEmbedding.findUnique({ where: { topicId } }),
    );

    return record === null ? null : toDto(record);
  }

  /**
   * Returns the topics most similar to `vector`, most similar first.
   *
   * Similarity is `1 - cosine distance`, so the value is comparable against a
   * configured threshold in `[0, 1]`. Deciding what counts as a duplicate is a
   * business rule and stays in the Topic Agent.
   *
   * @param vector Embedding of the candidate topic.
   * @param limit  Maximum number of neighbours to return.
   */
  public async findSimilar(
    vector: EmbeddingVectorDto,
    limit: number,
  ): Promise<readonly SimilarTopicDto[]> {
    const literal = toVectorLiteral(vector);

    const rows = await runQuery(
      'EmbeddingRepository.findSimilar',
      () =>
        this.database.$queryRaw<SimilarityRow[]>`
        SELECT e.topic_id, t.title, 1 - (e.vector <=> ${literal}::vector) AS similarity
        FROM topic_embeddings e
        JOIN topics t ON t.id = e.topic_id
        ORDER BY e.vector <=> ${literal}::vector
        LIMIT ${limit}
      `,
    );

    return rows.map((row) => ({
      topicId: row.topic_id,
      title: row.title,
      similarity: row.similarity,
    }));
  }

  /** Removes the embedding of a topic. */
  public async deleteByTopicId(topicId: string): Promise<void> {
    await runQuery('EmbeddingRepository.deleteByTopicId', () =>
      this.database.topicEmbedding.deleteMany({ where: { topicId } }),
    );
  }
}
