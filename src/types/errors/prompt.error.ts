import { ApplicationError } from './application.error.js';
import { ErrorCode } from './error-code.js';

/** Raised when a prompt file cannot be read. Never retryable. */
export class PromptNotFoundError extends ApplicationError {
  constructor(promptPath: string) {
    super({
      code: ErrorCode.PromptNotFound,
      message: `Prompt file "${promptPath}" was not found.`,
      retryable: false,
      details: { promptPath },
    });
  }
}

/**
 * Raised when a template still contains placeholders after substitution.
 *
 * Failing here is deliberate: sending `{{audience}}` verbatim to a model would
 * silently produce a plausible but wrong result, which is far harder to notice.
 */
export class PromptPlaceholderMissingError extends ApplicationError {
  constructor(promptName: string, missing: readonly string[]) {
    super({
      code: ErrorCode.PromptPlaceholderMissing,
      message: `Prompt "${promptName}" is missing values for: ${missing.join(', ')}.`,
      retryable: false,
      details: { promptName, missing },
    });
  }
}
