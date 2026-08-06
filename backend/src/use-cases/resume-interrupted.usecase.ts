import type { PipelineRequestDto } from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { ResumeSummary, RetryWorkflow } from '../workflows/retry.workflow.js';

/** Input for {@link ResumeInterruptedUseCase}. */
export interface ResumeInterruptedRequest {
  /** Parameters applied to any step that still needs them. */
  readonly defaults: PipelineRequestDto;
  /** Maximum number of interrupted runs to pick up in this invocation. */
  readonly limit: number;
}

/**
 * The business operation "finish what was interrupted".
 *
 * Kept separate from `GenerateContentUseCase` because operators invoke it for a
 * different reason: recovery after an incident, not production of new content.
 */
export class ResumeInterruptedUseCase {
  constructor(
    private readonly retryWorkflow: RetryWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Resumes interrupted runs and reports what happened. */
  public async execute(request: ResumeInterruptedRequest): Promise<ResumeSummary> {
    const logger = this.logger.child({ source: ResumeInterruptedUseCase.name });

    logger.info('Resume requested', { limit: request.limit });

    return this.retryWorkflow.resumeInterrupted(request.defaults, request.limit);
  }
}
