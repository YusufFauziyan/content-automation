import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised by the repository layer when PostgreSQL rejects or cannot serve a
 * query. Retryable by default: connection resets and deadlocks are transient.
 */
export class PersistenceError extends ApplicationError {
  constructor(message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.PersistenceFailure,
      message,
      retryable: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/**
 * Raised when a record the caller depends on does not exist.
 * Not retryable: the row will not appear on its own.
 */
export class RecordNotFoundError extends ApplicationError {
  constructor(entity: string, identifier: string) {
    super({
      code: ErrorCode.RecordNotFound,
      message: `${entity} "${identifier}" was not found.`,
      retryable: false,
      details: { entity, identifier },
    });
  }
}
