import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "give the video its voice and its captions".
 *
 * Narration, audio and subtitles run together because they are one decision
 * expressed three ways: the plan says what is spoken and when, the `.mp3` is
 * that plan spoken and the `.srt` is that plan written. Producing one without
 * the others leaves the run in a state nothing downstream can use.
 */
export class GenerateVoiceUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Produces the narration audio and subtitles, generating what precedes them if needed. */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: GenerateVoiceUseCase.name });
    logger.info('Narration requested', {
      resuming: request.resumeCorrelationId !== undefined,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.Subtitle,
    });

    if (!result.success) {
      logger.warn('Narration did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
