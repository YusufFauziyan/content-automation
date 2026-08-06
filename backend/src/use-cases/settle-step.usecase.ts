import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { RecordNotFoundError } from '../types/errors/persistence.error.js';
import { ErrorCode } from '../types/errors/error-code.js';
import type { Logger } from '../types/logger.js';
import { WorkflowStepStatus, type WorkflowStepName } from '../types/workflow.js';

/**
 * Statuses a person may put a step into.
 *
 * Only the two that mean something to decide by hand. `SUCCEEDED` says "this
 * happened, stop asking"; `FAILED` says "this did not, and I want it tried
 * again" — which is what makes Resume pick the step up. `RUNNING` is excluded
 * deliberately: nothing would be running, and claiming otherwise is exactly the
 * state this exists to get out of.
 */
export const SETTLEABLE: readonly WorkflowStepStatus[] = [
  WorkflowStepStatus.Succeeded,
  WorkflowStepStatus.Failed,
];

/**
 * Deciding a step's outcome by hand.
 *
 * A pipeline can be right about everything except what a person can see. The
 * publish step is where that bites: a video can be live while the step that
 * posted it was killed, and no amount of automated reasoning recovers that —
 * only somebody who looked.
 *
 * This is the escape hatch, kept narrow on purpose: it writes a status and a
 * note saying a person wrote it, and nothing else. It does not re-run anything,
 * publish anything, or touch the upload history.
 */
export class SettleStepUseCase {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * @throws {AgentOutputInvalidError} When the status is not one to settle on.
   * @throws {RecordNotFoundError} When the run has no such step recorded.
   */
  public async settle(
    workflowRunId: string,
    step: WorkflowStepName,
    status: WorkflowStepStatus,
  ): Promise<void> {
    if (!SETTLEABLE.includes(status)) {
      throw new AgentOutputInvalidError(
        SettleStepUseCase.name,
        'A step can be settled as succeeded or failed, nothing else.',
        { step, status },
      );
    }

    const steps = await this.workflowRepository.findSteps(workflowRunId);
    const existing = steps.find((recorded) => recorded.step === step);

    if (existing === undefined) {
      throw new RecordNotFoundError('workflow step', `${workflowRunId}/${step}`);
    }

    await this.workflowRepository.recordStep(workflowRunId, step, {
      status,
      attempt: existing.attempt,
      finishedAt: new Date(),
      // The note survives in `workflow_step_runs.last_error`, which is where
      // anyone reading this run later will look. A step that says SUCCEEDED
      // with no explanation is indistinguishable from one the pipeline
      // completed, and those are not the same fact.
      lastError:
        status === WorkflowStepStatus.Succeeded
          ? {
              name: 'SettledByHand',
              code: ErrorCode.RunInterrupted,
              message: 'Marked as done by a person, not by the pipeline.',
              retryable: false,
              details: {},
            }
          : {
              name: 'SettledByHand',
              code: ErrorCode.RunInterrupted,
              message: 'Marked as needing another attempt by a person. Resume to retry it.',
              retryable: true,
              details: {},
            },
    });

    this.logger.info('Settled a step by hand', {
      source: SettleStepUseCase.name,
      workflowRunId,
      step,
      status,
    });
  }
}
