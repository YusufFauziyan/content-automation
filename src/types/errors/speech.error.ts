import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when a call to the speech server fails.
 *
 * Retryability is decided here, where the transport result is known: a 503 is
 * worth another attempt, a 400 never is.
 */
export class SpeechServiceError extends ApplicationError {
  constructor(message: string, retryable: boolean, details?: ErrorDetails) {
    super({
      code: ErrorCode.SpeechRequestFailed,
      message,
      retryable,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Raised when the speech server did not answer within the configured timeout. */
export class SpeechTimeoutError extends ApplicationError {
  constructor(timeoutMs: number, details?: ErrorDetails) {
    super({
      code: ErrorCode.SpeechTimeout,
      message: `Kokoro did not respond within ${String(timeoutMs)}ms.`,
      retryable: true,
      details: { timeoutMs, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when the server answered, but not with usable audio.
 *
 * Retryable: a truncated or empty response is usually transient, and the same
 * request frequently succeeds on the next attempt.
 */
export class SpeechInvalidResponseError extends ApplicationError {
  constructor(message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.SpeechInvalidResponse,
      message,
      retryable: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/**
 * Raised when a speech call has used its whole retry budget.
 *
 * Never retryable, for the same reason as its router counterpart: the policy
 * has already been applied in full, and retrying on top of it would square the
 * operator's configured budget.
 */
export class SpeechRetriesExhaustedError extends ApplicationError {
  constructor(attempts: number, cause: ApplicationError) {
    super({
      code: ErrorCode.SpeechRetriesExhausted,
      message: `Kokoro synthesis failed after ${String(attempts)} attempt(s): ${cause.message}`,
      retryable: false,
      details: { attempts, cause: cause.toJSON() },
    });
  }
}
