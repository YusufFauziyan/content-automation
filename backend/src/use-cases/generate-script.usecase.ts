import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "write the script for a topic".
 *
 * Given `resumeCorrelationId` it continues an existing run, so a topic that was
 * generated earlier is scripted without being generated again. Without one it
 * produces the topic first, because a script needs a subject.
 */
export class GenerateScriptUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Produces and stores the script, generating the topic first if needed. */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: GenerateScriptUseCase.name });
    logger.info('Script generation requested', {
      resuming: request.resumeCorrelationId !== undefined,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.Script,
    });

    if (!result.success) {
      logger.warn('Script generation did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
