import type { GenerateContentWorkflow } from './generate-content.workflow.js';
import type { PipelineConfig } from '../config/app.config.js';
import type { PipelineRequestDto } from '../dto/workflow-context.dto.js';
import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import type { Logger } from '../types/logger.js';

/** Outcome of one sweep over the interrupted runs. */
export interface ResumeSummary {
  readonly inspected: number;
  readonly resumed: number;
  readonly failed: number;
}

/**
 * Picks up runs that were interrupted and drives them to completion.
 *
 * A crashed process leaves its run without a `finished_at`. This workflow is
 * what turns that row back into progress, and it exists separately from
 * {@link GenerateContentWorkflow} because "decide what to resume" and "execute
 * the pipeline" are different responsibilities: one is a recovery policy, the
 * other is the pipeline itself.
 *
 * Resuming never restarts a run from the beginning — the run's recorded steps
 * decide where it continues.
 */
export class RetryWorkflow {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly pipelineConfig: PipelineConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Resumes up to `limit` interrupted runs, oldest first.
   *
   * Runs are resumed sequentially: they compete for the same external systems,
   * so resuming them concurrently would trade one backlog for another.
   *
   * @param defaults Parameters applied to any step that still needs them.
   * @param limit    Maximum number of runs to resume in this sweep.
   */
  public async resumeInterrupted(
    defaults: PipelineRequestDto,
    limit: number,
  ): Promise<ResumeSummary> {
    const runs = await this.workflowRepository.findResumableRuns(limit);
    const logger = this.logger.child({ source: RetryWorkflow.name });

    logger.info('Resume sweep started', { inspected: runs.length });

    let resumed = 0;
    let failed = 0;

    for (const run of runs) {
      const result = await this.generateContentWorkflow.execute({
        ...defaults,
        resumeCorrelationId: run.correlationId,
        stopAfterStep: this.pipelineConfig.lastStep,
      });

      if (result.success) {
        resumed += 1;
      } else {
        failed += 1;
        logger.warn('Resume attempt failed', {
          correlationId: run.correlationId,
          errorCode: result.error.code,
        });
      }
    }

    logger.info('Resume sweep finished', { inspected: runs.length, resumed, failed });

    return { inspected: runs.length, resumed, failed };
  }
}
