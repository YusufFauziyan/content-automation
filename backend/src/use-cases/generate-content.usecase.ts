import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { PipelineConfig } from '../config/app.config.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';

/**
 * The business operation "produce one complete piece of content".
 *
 * This is the stable entry point callers depend on: a CLI command, a scheduler
 * tick and, later, an HTTP handler all invoke this and none of them learn how
 * many workflows or agents are involved.
 *
 * How far it runs is configuration, not a constant: `PIPELINE_LAST_STEP` lets a
 * deployment stop before a stage whose external system is not ready yet, and
 * moving it later needs no code change and no caller change.
 */
export class GenerateContentUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly pipelineConfig: PipelineConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Produces content for one new topic.
   *
   * @param request Category, language, audience, length and visual style, plus
   *                the correlation id of an interrupted run to continue.
   */
  public async execute(request: PipelineRequestDto): Promise<Result<GenerateContentResponseDto>> {
    const logger = this.logger.child({ source: GenerateContentUseCase.name });

    logger.info('Generate content requested', {
      category: request.category,
      language: request.language,
      resuming: request.resumeCorrelationId !== undefined,
      lastStep: this.pipelineConfig.lastStep,
    });

    const result = await this.generateContentWorkflow.execute({
      ...request,
      stopAfterStep: this.pipelineConfig.lastStep,
    });

    if (!result.success) {
      logger.warn('Generate content did not complete', { errorCode: result.error.code });
    }

    return result;
  }
}
