import { toDbTopicStatus, toTopicStatus } from '../database/enum.map.js';
import type { Topic as TopicRecord } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import type { NewTopicDto, TopicDto } from '../dto/topic.dto.js';
import type { TopicStatus } from '../types/topic.js';

/** Maps a database row onto the domain DTO. */
const toDto = (record: TopicRecord): TopicDto => ({
  id: record.id,
  title: record.title,
  normalizedTitle: record.normalizedTitle,
  description: record.description,
  language: record.language,
  category: record.category,
  audience: record.audience,
  status: toTopicStatus(record.status),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/**
 * Persistence for content subjects.
 *
 * Tables
 * - `topics`
 *
 * Methods
 * - {@link create}
 * - {@link findById}
 * - {@link findByNormalizedTitle}
 * - {@link findRecentTitles}
 * - {@link updateStatus}
 * - {@link delete}
 *
 * This repository performs CRUD only. Duplicate *detection* is a business rule
 * and lives in the Topic Agent; the exact-title lookup it needs is exposed as
 * {@link findByNormalizedTitle}, and the semantic half lives in
 * `EmbeddingRepository`.
 */
export class TopicRepository {
  constructor(private readonly database: Database) {}

  /** Inserts a topic. The caller supplies the normalised title. */
  public async create(input: NewTopicDto): Promise<TopicDto> {
    const record = await runQuery('TopicRepository.create', () =>
      this.database.topic.create({
        data: {
          title: input.title,
          normalizedTitle: input.normalizedTitle,
          description: input.description,
          language: input.language,
          category: input.category,
          audience: input.audience,
          status: toDbTopicStatus(input.status),
        },
      }),
    );

    return toDto(record);
  }

  /** Returns the topic, or `null` when the id is unknown. */
  public async findById(id: string): Promise<TopicDto | null> {
    const record = await runQuery('TopicRepository.findById', () =>
      this.database.topic.findUnique({ where: { id } }),
    );

    return record === null ? null : toDto(record);
  }

  /** Exact-match lookup backing the first stage of duplicate detection. */
  public async findByNormalizedTitle(normalizedTitle: string): Promise<TopicDto | null> {
    const record = await runQuery('TopicRepository.findByNormalizedTitle', () =>
      this.database.topic.findUnique({ where: { normalizedTitle } }),
    );

    return record === null ? null : toDto(record);
  }

  /**
   * Returns the most recent titles in a category, newest first.
   *
   * The Topic Agent sends these to the model as an exclusion list, so that a
   * duplicate is avoided rather than generated and then rejected.
   *
   * @param category Category to filter by, or `null` for every category.
   * @param limit    Maximum number of titles to return.
   */
  public async findRecentTitles(
    category: string | null,
    limit: number,
  ): Promise<readonly string[]> {
    const records = await runQuery('TopicRepository.findRecentTitles', () =>
      this.database.topic.findMany({
        where: category === null ? {} : { category },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { title: true },
      }),
    );

    return records.map((record) => record.title);
  }

  /** Moves a topic through its lifecycle. */
  public async updateStatus(id: string, status: TopicStatus): Promise<TopicDto> {
    const record = await runQuery('TopicRepository.updateStatus', () =>
      this.database.topic.update({
        where: { id },
        data: { status: toDbTopicStatus(status) },
      }),
    );

    return toDto(record);
  }

  /** Removes a topic together with its embedding and content (cascade). */
  public async delete(id: string): Promise<void> {
    await runQuery('TopicRepository.delete', () => this.database.topic.delete({ where: { id } }));
  }
}
