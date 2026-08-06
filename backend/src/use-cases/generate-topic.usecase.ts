import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "add one unique topic to the backlog".
 *
 * It runs the same pipeline as every other content operation and stops after
 * the topic step. Modelling it this way — rather than as a second workflow —
 * means a topic produced here is already a resumable run: continuing it into a
 * script later costs nothing and repeats nothing.
 */
export class GenerateTopicUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /** Produces and stores one unique topic. */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: GenerateTopicUseCase.name });
    logger.info('Topic generation requested', {
      category: request.category,
      language: request.language,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.Topic,
    });

    if (!result.success) {
      logger.warn('Topic generation did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
