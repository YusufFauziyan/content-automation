import type { EmbeddingVectorDto } from '../dto/embedding.dto.js';

/**
 * Contract for text embeddings.
 *
 * External system: the embedding model exposed through OpenClaw.
 *
 * The service returns a vector. Comparing vectors against a threshold and
 * deciding that a topic is a duplicate is the Topic Agent's decision, and the
 * search itself belongs to `EmbeddingRepository`.
 */
export interface EmbeddingService {
  /**
   * Embeds one piece of text.
   *
   * @throws {ApplicationError} Marked retryable for rate limits.
   */
  embed(text: string): Promise<EmbeddingVectorDto>;
}
