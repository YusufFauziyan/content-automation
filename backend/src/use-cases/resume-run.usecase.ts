import type { PipelineRequestDto } from '../dto/workflow-context.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import { RecordNotFoundError } from '../types/errors/persistence.error.js';
import type { Logger } from '../types/logger.js';
import type { ResumeSummary, RetryWorkflow } from '../workflows/retry.workflow.js';

export interface ResumeRunRequest {
  /** Identity of the run to continue. */
  readonly runId: string;
  /** Parameters applied to any step that still needs them. */
  readonly defaults: PipelineRequestDto;
}

/**
 * The business operation "continue this run".
 *
 * Distinct from {@link ResumeInterruptedUseCase}, which sweeps a backlog: here
 * a person has looked at one failed run, fixed whatever blocked it — often by
 * supplying a still the generator could not produce — and asked for it to carry
 * on from the step that stopped.
 */
export class ResumeRunUseCase {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly contentRepository: ContentRepository,
    private readonly retryWorkflow: RetryWorkflow,
    private readonly logger: Logger,
  ) {}

  /**
   * @throws {RecordNotFoundError} When no run carries that id.
   */
  public async execute(request: ResumeRunRequest): Promise<ResumeSummary> {
    const run = await this.workflowRepository.findRunById(request.runId);

    if (run === null) {
      throw new RecordNotFoundError('WorkflowRun', request.runId);
    }

    // The language belongs to the run, not to whoever pressed Resume. It was
    // chosen when the workflow was created and written to `contents.language`;
    // taking it from the caller's defaults instead made a resumed Indonesian
    // video come back narrated in English.
    const content = run.contentId === null ? null : await this.contentRepository.findById(run.contentId);
    const defaults =
      content === null ? request.defaults : { ...request.defaults, language: content.language };

    this.logger.info('Resuming a single run', {
      source: ResumeRunUseCase.name,
      workflowRunId: run.id,
      correlationId: run.correlationId,
      language: defaults.language,
    });

    return this.retryWorkflow.resumeRun(run.correlationId, defaults);
  }
}
