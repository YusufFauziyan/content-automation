import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when FFmpeg exits with a failure.
 *
 * Retryability is decided by the caller that knows what happened: a killed
 * process or an exhausted disk may clear, a malformed filter graph never will.
 */
export class RenderError extends ApplicationError {
  constructor(message: string, retryable: boolean, details?: ErrorDetails) {
    super({
      code: ErrorCode.RenderFailed,
      message,
      retryable,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Raised when a render exceeds the configured time budget. */
export class RenderTimeoutError extends ApplicationError {
  constructor(timeoutMs: number, details?: ErrorDetails) {
    super({
      code: ErrorCode.RenderTimeout,
      message: `FFmpeg did not finish within ${String(timeoutMs)}ms.`,
      retryable: true,
      details: { timeoutMs, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when the binary cannot be run at all.
 *
 * Never retryable: a missing or unexecutable `ffmpeg` is a deployment problem,
 * and repeating the attempt only delays reporting it.
 */
export class RenderToolUnavailableError extends ApplicationError {
  constructor(binaryPath: string, reason: string) {
    super({
      code: ErrorCode.RenderToolUnavailable,
      message: `Could not run "${binaryPath}": ${reason}`,
      retryable: false,
      details: { binaryPath, reason },
    });
  }
}

/**
 * Raised when a render call has used its whole retry budget.
 *
 * Never retryable, for the same reason as its router and speech counterparts:
 * the configured policy has already been applied in full.
 */
export class RenderRetriesExhaustedError extends ApplicationError {
  constructor(attempts: number, cause: ApplicationError) {
    super({
      code: ErrorCode.RenderRetriesExhausted,
      message: `Rendering failed after ${String(attempts)} attempt(s): ${cause.message}`,
      retryable: false,
      details: { attempts, cause: cause.toJSON() },
    });
  }
}
