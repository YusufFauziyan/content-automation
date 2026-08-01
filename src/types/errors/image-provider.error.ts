import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when a call to the fallback image provider fails.
 *
 * Retryability is decided here, where the transport result is known: a 503 is
 * worth another attempt, a 401 never is.
 */
export class ImageProviderError extends ApplicationError {
  constructor(message: string, retryable: boolean, details?: ErrorDetails) {
    super({
      code: ErrorCode.ImageProviderRequestFailed,
      message,
      retryable,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Raised when the provider did not answer within the configured timeout. */
export class ImageProviderTimeoutError extends ApplicationError {
  constructor(timeoutMs: number, details?: ErrorDetails) {
    super({
      code: ErrorCode.ImageProviderTimeout,
      message: `The image provider did not respond within ${String(timeoutMs)}ms.`,
      retryable: true,
      details: { timeoutMs, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when the provider answered, but not with usable image data.
 *
 * Retryable: an empty or truncated answer is usually transient, and the same
 * request frequently succeeds on the next attempt.
 */
export class ImageProviderInvalidResponseError extends ApplicationError {
  constructor(message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.ImageProviderInvalidResponse,
      message,
      retryable: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/**
 * Raised when a provider call has used its whole retry budget.
 *
 * Never retryable, for the same reason as its router counterpart: the policy
 * has already been applied in full, and retrying on top of it would square the
 * operator's configured budget.
 */
export class ImageProviderRetriesExhaustedError extends ApplicationError {
  constructor(attempts: number, cause: ApplicationError) {
    super({
      code: ErrorCode.ImageProviderRetriesExhausted,
      message: `Image provider generation failed after ${String(attempts)} attempt(s): ${cause.message}`,
      retryable: false,
      details: { attempts, cause: cause.toJSON() },
    });
  }
}
