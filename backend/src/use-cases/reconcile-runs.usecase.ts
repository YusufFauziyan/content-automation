import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import { ErrorCode } from '../types/errors/error-code.js';
import type { Logger } from '../types/logger.js';
import { WorkflowStatus, WorkflowStepStatus } from '../types/workflow.js';

export interface ReconcileResult {
  readonly runs: number;
  readonly steps: number;
}

/**
 * Settles runs that a previous process left mid-flight.
 *
 * A workflow marks a step `RUNNING` before starting it and only writes the
 * outcome afterwards. If the process dies in between — a crash, a deploy, a
 * terminal closed — that row stays `RUNNING` for ever. Nothing is executing it,
 * but everything that reads the database believes something is: the editor
 * shows a spinner that never stops and refuses to offer Resume, which is
 * exactly the state a person cannot get out of.
 *
 * A freshly started process knows one thing for certain: nothing it inherited
 * is still running. So it says so, once, at startup.
 */
export class ReconcileRunsUseCase {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(limit: number): Promise<ReconcileResult> {
    // Asked for by step, not by run. Walking "resumable" runs missed the case
    // that matters most: a run whose status says it finished, still carrying a
    // step nothing is executing. The editor spun on those for ever, because the
    // one row that says "in progress" was never looked at.
    const stranded = await this.workflowRepository.findStrandedSteps(limit);
    const touched = new Set<string>();

    for (const step of stranded) {
      await this.workflowRepository.recordStep(step.workflowRunId, step.step, {
        status: WorkflowStepStatus.Failed,
        attempt: step.attempt,
        durationMs: 0,
        finishedAt: new Date(),
        lastError: {
          name: 'RunInterruptedError',
          code: ErrorCode.RunInterrupted,
          message: 'The process running this step stopped before it finished. Resume to continue.',
          retryable: true,
          details: {},
        },
      });

      if (!touched.has(step.workflowRunId)) {
        await this.workflowRepository.updateRun(step.workflowRunId, {
          status: WorkflowStatus.Failed,
          finishedAt: new Date(),
        });
        touched.add(step.workflowRunId);
      }

      this.logger.warn('Settled a step left mid-flight', {
        source: ReconcileRunsUseCase.name,
        workflowRunId: step.workflowRunId,
        step: step.step,
      });
    }

    const touchedRuns = touched.size;
    const touchedSteps = stranded.length;

    return { runs: touchedRuns, steps: touchedSteps };
  }
}
