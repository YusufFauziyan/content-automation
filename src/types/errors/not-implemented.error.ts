import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised by a scaffolded seam that is deliberately empty in the current
 * milestone. Never retryable — retrying cannot make the feature appear.
 *
 * Every occurrence is a tracked piece of remaining work, not a silent gap.
 */
export class NotImplementedError extends ApplicationError {
  constructor(subject: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.NotImplemented,
      message: `${subject} is not implemented yet.`,
      retryable: false,
      ...(details === undefined ? {} : { details }),
    });
  }
}
