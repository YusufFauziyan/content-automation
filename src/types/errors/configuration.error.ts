import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when environment variables fail validation during startup.
 * Never retryable: the process must not run with unknown configuration.
 */
export class ConfigurationError extends ApplicationError {
  constructor(message: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.ConfigurationInvalid,
      message,
      retryable: false,
      ...(details === undefined ? {} : { details }),
    });
  }
}
