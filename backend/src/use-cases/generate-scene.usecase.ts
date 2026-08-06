import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "plan the shots for a script".
 *
 * Given `resumeCorrelationId` it continues an existing run; otherwise it walks
 * the pipeline from the topic, because a shot list needs a script and a script
 * needs a subject.
 */
export class GenerateSceneUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Produces and stores the scene plan, generating what precedes it if needed. */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: GenerateSceneUseCase.name });
    logger.info('Scene planning requested', {
      resuming: request.resumeCorrelationId !== undefined,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.Scene,
    });

    if (!result.success) {
      logger.warn('Scene planning did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
