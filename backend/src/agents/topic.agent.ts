import { z } from 'zod';

import type { ContentConfig } from '../config/app.config.js';
import type {
  NewTopicDto,
  TopicCandidateDto,
  TopicDto,
  TopicRequestDto,
} from '../dto/topic.dto.js';
import type { EmbeddingRepository } from '../repositories/embedding.repository.js';
import type { TopicRepository } from '../repositories/topic.repository.js';
import { AiMessageRole, type NineRouterService } from '../services/nine-router.service.js';
import type { EmbeddingService } from '../services/embedding.service.js';
import { PromptName, type PromptLoader } from '../services/prompt-loader.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError, TopicAlreadyExistsError, TopicNotUniqueError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';
import { TopicStatus } from '../types/topic.js';

/** How many recent titles are sent to the model as an exclusion list. */
const EXCLUSION_LIST_SIZE = 50;

/** How many semantic neighbours to inspect per candidate. */
const SIMILARITY_NEIGHBOURS = 5;

/** Shape the model is asked to answer with. */
const candidateSchema = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(2000).nullish(),
});

/**
 * Collapses a title to its comparable form.
 *
 * Exact duplicate detection must not be defeated by casing or stray spacing,
 * so the comparison key is derived rather than trusted from the model.
 */
export const normalizeTitle = (title: string): string =>
  title.toLowerCase().replace(/\s+/gu, ' ').trim();

/**
 * Produces one unique topic.
 *
 * Purpose
 * - Propose a candidate topic, reject it if the platform has covered it
 *   before, and try again until a unique topic is found.
 *
 * Input
 * - {@link TopicRequestDto}
 *
 * Output
 * - {@link TopicDto} — persisted and marked `ACCEPTED`.
 *
 * Dependencies
 * - `NineRouterService` — proposes candidates.
 * - `PromptLoader` — loads `topic.md`.
 * - `TopicRepository` — exact-title lookup and persistence.
 * - `EmbeddingRepository` — semantic neighbour search.
 * - `EmbeddingService` — embeds the candidate title; `null` until the embedding
 *   model is wired, in which case only exact-title rejection applies.
 *
 * Rejection happens in two stages, cheapest first: an exact normalised-title
 * lookup, then semantic similarity above the configured threshold
 * (ARCHITECTURE.md "Duplicate Detection"). Rejected titles are fed back into
 * the next prompt so the model stops proposing the same thing.
 *
 * Must not generate a script.
 */
export class TopicAgent implements Agent<TopicRequestDto, TopicDto> {
  public readonly name = 'TopicAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    private readonly promptLoader: PromptLoader,
    private readonly topicRepository: TopicRepository,
    private readonly embeddingRepository: EmbeddingRepository,
    private readonly embeddingService: EmbeddingService | null,
    private readonly config: ContentConfig,
    private readonly logger: Logger,
  ) {}

  public async execute(input: TopicRequestDto): Promise<Result<TopicDto>> {
    const logger = this.logger.child({ source: this.name, correlationId: input.correlationId });
    const startedAt = Date.now();
    logger.info('START');

    try {
      const topic = await this.findUniqueTopic(input, logger);
      logger.info('SUCCESS', { durationMs: Date.now() - startedAt, topicId: topic.id });

      return ok(topic);
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /** Proposes candidates until one survives duplicate detection. */
  private async findUniqueTopic(input: TopicRequestDto, logger: Logger): Promise<TopicDto> {
    const excluded = [
      ...(await this.topicRepository.findRecentTitles(input.category, EXCLUSION_LIST_SIZE)),
    ];
    const rejected: string[] = [];

    // A title someone typed is used as-is and tried once. Retrying would mean
    // silently replacing their subject with a different one, which is the
    // opposite of what asking for a specific topic means.
    const attempts = input.requestedTitle === undefined ? this.config.topicMaxAttempts : 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const candidate =
        input.requestedTitle === undefined
          ? await this.proposeCandidate(input, excluded)
          : { title: input.requestedTitle.trim(), description: null, angle: 'requested' };
      const normalizedTitle = normalizeTitle(candidate.title);

      const reason = await this.rejectionReason(normalizedTitle, candidate.title);

      if (reason !== null) {
        logger.warn('Candidate topic rejected', {
          retryCount: attempt,
          title: candidate.title,
          reason,
        });
        rejected.push(candidate.title);
        excluded.push(candidate.title);
        continue;
      }

      return this.persist(input, candidate, normalizedTitle);
    }

    // A title someone typed is tried once, so reporting the configured budget
    // would claim five attempts were made when one was. And the reason differs:
    // a generated topic ran out of ideas, a supplied one simply already exists.
    if (input.requestedTitle !== undefined) {
      throw new TopicAlreadyExistsError(input.requestedTitle.trim());
    }

    throw new TopicNotUniqueError(attempts, rejected);
  }

  /** Asks the model for one candidate and validates its answer. */
  private async proposeCandidate(
    input: TopicRequestDto,
    excluded: readonly string[],
  ): Promise<TopicCandidateDto> {
    const prompt = await this.promptLoader.render(
      { name: PromptName.Topic },
      {
        category: input.category,
        language: input.language,
        audience: input.audience,
        durationSeconds: String(input.durationSeconds),
        excludedTitles:
          excluded.length === 0 ? '(none yet)' : excluded.map((title) => `- ${title}`).join('\n'),
      },
    );

    const payload = await this.nineRouter.completeJson({
      messages: [{ role: AiMessageRole.User, content: prompt }],
      temperature: 1,
    });

    const parsed = candidateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AgentOutputInvalidError(this.name, 'topic payload failed validation', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    return { title: parsed.data.title, description: parsed.data.description ?? null };
  }

  /**
   * Returns why a candidate must be rejected, or `null` when it is unique.
   *
   * The exact lookup runs first because it is a single indexed query; the
   * semantic check costs an embedding call and is only worth doing on titles
   * that already passed the cheap test.
   */
  private async rejectionReason(normalizedTitle: string, title: string): Promise<string | null> {
    const existing = await this.topicRepository.findByNormalizedTitle(normalizedTitle);

    if (existing !== null) {
      return 'exact title already exists';
    }

    if (this.embeddingService === null) {
      return null;
    }

    const vector = await this.embeddingService.embed(title);
    const neighbours = await this.embeddingRepository.findSimilar(vector, SIMILARITY_NEIGHBOURS);
    const closest = neighbours[0];

    if (closest !== undefined && closest.similarity >= this.config.topicSimilarityThreshold) {
      return `semantically similar to "${closest.title}"`;
    }

    return null;
  }

  /** Stores the accepted candidate. */
  private async persist(
    input: TopicRequestDto,
    candidate: TopicCandidateDto,
    normalizedTitle: string,
  ): Promise<TopicDto> {
    const newTopic: NewTopicDto = {
      title: candidate.title,
      description: candidate.description,
      normalizedTitle,
      language: input.language,
      category: input.category,
      audience: input.audience,
      status: TopicStatus.Accepted,
    };

    return this.topicRepository.create(newTopic);
  }
}
