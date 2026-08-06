import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "turn everything produced into a finished video".
 *
 * Building the timeline and rendering it run together because a plan nobody
 * renders is not something an operator asks for, and keeping them in one
 * operation is what lets a failed render be retried against the very plan that
 * produced it.
 */
export class RenderVideoUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Produces `final.mp4`, generating whatever precedes it if needed. */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: RenderVideoUseCase.name });
    logger.info('Render requested', {
      resuming: request.resumeCorrelationId !== undefined,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.Compose,
    });

    if (!result.success) {
      logger.warn('Render did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
