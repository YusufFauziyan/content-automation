import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';
import type { WorkflowStepName } from '../workflow.js';

/**
 * Raised when a workflow step fails after its retry budget is exhausted, or
 * fails with a non-retryable cause. Carries the step so the run can be resumed
 * from exactly that point.
 */
export class WorkflowStepError extends ApplicationError {
  public readonly step: WorkflowStepName;

  constructor(step: WorkflowStepName, message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.WorkflowStepFailed,
      message,
      retryable: false,
      details: { step, ...(details ?? {}) },
    });
    this.step = step;
  }
}
