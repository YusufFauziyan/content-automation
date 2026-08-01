/** A vector produced by the embedding service. */
export interface EmbeddingVectorDto {
  /** Identifier of the model that produced the vector, e.g. an embedding model id. */
  readonly model: string;
  readonly dimensions: number;
  readonly values: readonly number[];
}

/** Input accepted by `EmbeddingRepository.save`. */
export interface NewTopicEmbeddingDto {
  readonly topicId: string;
  readonly vector: EmbeddingVectorDto;
}

/** A persisted topic embedding. */
export interface TopicEmbeddingDto {
  readonly id: string;
  readonly topicId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly createdAt: Date;
}

/** A neighbour returned by semantic duplicate detection. */
export interface SimilarTopicDto {
  readonly topicId: string;
  readonly title: string;
  /** Cosine similarity in `[0, 1]`; higher means more alike. */
  readonly similarity: number;
}
