import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "produce the stills for a video".
 *
 * Given `resumeCorrelationId` it continues an existing run, so a scene plan
 * that already exists is illustrated rather than re-planned. Without one it
 * walks the pipeline from the topic, because an image needs a brief, a brief
 * needs a shot list, and a shot list needs a script.
 *
 * Visual planning is not a separate operation: a brief nobody renders is not
 * something an operator asks for, and running the two together is what makes a
 * failed image retryable against the brief that produced it.
 */
export class GenerateImageUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Produces one image per scene, generating what precedes them if needed. */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: GenerateImageUseCase.name });
    logger.info('Image generation requested', {
      resuming: request.resumeCorrelationId !== undefined,
      aspectRatio: request.aspectRatio,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.Image,
    });

    if (!result.success) {
      logger.warn('Image generation did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
