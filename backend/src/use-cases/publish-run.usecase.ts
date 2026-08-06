import type { GenerateContentWorkflow } from '../workflows/generate-content.workflow.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import type { UploadPlatform } from '../types/upload.js';

/**
 * Publishing a finished run's video on request.
 *
 * Separate from resuming, because it answers a different question. A resume
 * asks "what has this run not done yet"; this asks "send that video there,
 * now" — which is what a person wants after a publish was interrupted, or after
 * one platform took the video and another did not.
 *
 * Nothing is re-rendered. If the run has no video, it says so rather than
 * quietly making one.
 */
export class PublishRunUseCase {
  constructor(
    private readonly generateContentWorkflow: GenerateContentWorkflow,
    private readonly logger: Logger,
  ) {}

  /**
   * @param platforms Destinations to publish to, or every connected one.
   */
  public async execute(
    workflowRunId: string,
    platforms?: readonly UploadPlatform[],
  ): Promise<Result<void>> {
    this.logger.info('Publishing a run on request', {
      source: PublishRunUseCase.name,
      workflowRunId,
      platforms: platforms ?? 'all connected',
    });

    return this.generateContentWorkflow.publish(workflowRunId, platforms);
  }
}
