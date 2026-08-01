import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when a call to the AI router fails.
 *
 * Retryability is decided here, at the only place that knows what the transport
 * reported: a 429 or a 503 is worth another attempt, a 401 never is. The
 * workflow simply honours the flag.
 */
export class AiRouterError extends ApplicationError {
  constructor(message: string, retryable: boolean, details?: ErrorDetails) {
    super({
      code: ErrorCode.AiRequestFailed,
      message,
      retryable,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Raised when the router did not answer within the configured timeout. */
export class AiTimeoutError extends ApplicationError {
  constructor(timeoutMs: number, details?: ErrorDetails) {
    super({
      code: ErrorCode.AiTimeout,
      message: `AI router did not respond within ${String(timeoutMs)}ms.`,
      retryable: true,
      details: { timeoutMs, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when a router call has used its whole retry budget.
 *
 * Never retryable, and that is the point: the transport already applied the
 * configured policy in full. Letting a caller retry on top of it would square
 * the operator's budget and turn a permanent failure into a minute of waiting.
 * The failure that actually caused it is preserved in `details.cause`.
 */
export class AiRetriesExhaustedError extends ApplicationError {
  constructor(operation: string, attempts: number, cause: ApplicationError) {
    super({
      code: ErrorCode.AiRetriesExhausted,
      message: `9 Router ${operation} failed after ${String(attempts)} attempt(s): ${cause.message}`,
      retryable: false,
      details: { operation, attempts, cause: cause.toJSON() },
    });
  }
}

/**
 * Raised when the router answered, but the payload is not the agreed shape.
 *
 * Retryable: language models are non-deterministic, and the identical prompt
 * frequently produces valid JSON on the next attempt.
 */
export class AiInvalidResponseError extends ApplicationError {
  constructor(message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.AiInvalidResponse,
      message,
      retryable: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}
