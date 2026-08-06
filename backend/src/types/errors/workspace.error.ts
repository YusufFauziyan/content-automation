import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when the run's working directory cannot be prepared or written to.
 *
 * Retryable: a full disk or a transient permission problem may clear, and the
 * alternative — losing an image that was already paid for — is worse.
 */
export class WorkspaceError extends ApplicationError {
  constructor(message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.WorkspaceFailure,
      message,
      retryable: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/**
 * Raised when an identifier would escape the working directory.
 *
 * Never retryable, and deliberately a hard failure: a path segment that is not
 * a plain identifier has no legitimate reason to reach the filesystem.
 */
export class UnsafeWorkspacePathError extends ApplicationError {
  constructor(segment: string) {
    super({
      code: ErrorCode.WorkspaceUnsafePath,
      message: `"${segment}" is not a safe path segment.`,
      retryable: false,
      details: { segment },
    });
  }
}
