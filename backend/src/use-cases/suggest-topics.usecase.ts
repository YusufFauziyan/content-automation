import type { TopicIdeaDto } from '../dto/topic-idea.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import type { SuggestTopicsWorkflow } from '../workflows/suggest-topics.workflow.js';

export interface SuggestTopicsRequest {
  readonly correlationId: string;
  readonly language: string;
  readonly count: number;
  readonly durationSeconds: number;
  /** Titles already refused in this attempt, so they are not proposed again. */
  readonly alsoExclude?: readonly string[];
  /** Area of knowledge to search in. Random when not given. */
  readonly angle?: string;
}

/**
 * The business operation "give me something to make a video about".
 *
 * Separate from `GenerateTopicUseCase`, which commits: that one picks a subject
 * and writes it to the library. This one only offers, because a person deciding
 * what to make should be able to look at five ideas and take none of them
 * without leaving a trace.
 */
export class SuggestTopicsUseCase {
  constructor(
    private readonly suggestTopicsWorkflow: SuggestTopicsWorkflow,
    private readonly logger: Logger,
  ) {}

  public async execute(request: SuggestTopicsRequest): Promise<Result<readonly TopicIdeaDto[]>> {
    this.logger.info('Topic suggestions requested', {
      source: SuggestTopicsUseCase.name,
      correlationId: request.correlationId,
      language: request.language,
    });

    return this.suggestTopicsWorkflow.suggest(request);
  }
}
