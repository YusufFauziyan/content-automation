import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when no enabled account exists for the platform a run targets.
 *
 * Never retryable: repeating the attempt cannot conjure a credential, and the
 * fix — connect an account — is a person's, not a workflow's.
 */
export class CredentialMissingError extends ApplicationError {
  constructor(platform: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.CredentialMissing,
      message: `No enabled ${platform} account is connected.`,
      retryable: false,
      details: { platform, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when the stored browser session is no longer signed in.
 *
 * Distinct from a generic failure on purpose. Everything else here might clear
 * on its own; this one never does, and reporting it as a retryable upload error
 * would send the workflow round three times before showing an operator the only
 * message that matters: log in again.
 */
export class PublishSessionExpiredError extends ApplicationError {
  constructor(platform: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.PublishSessionExpired,
      message: `The saved ${platform} session has expired — capture a new one with \`pnpm tiktok:login\`.`,
      retryable: false,
      details: { platform, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when the platform refused the upload or the page never got there.
 *
 * Retryability is the caller's to decide: a page that timed out mid-navigation
 * may succeed next time, a video the platform rejected will not.
 */
export class PublishFailedError extends ApplicationError {
  constructor(message: string, retryable: boolean, details?: ErrorDetails) {
    super({
      code: ErrorCode.PublishFailed,
      message,
      retryable,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Raised when a publish exceeds its configured time budget. */
export class PublishTimeoutError extends ApplicationError {
  constructor(timeoutMs: number, stage: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.PublishTimeout,
      message: `Publishing did not get past ${stage} within ${String(timeoutMs)}ms.`,
      retryable: false,
      details: { timeoutMs, stage, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when a submitted upload cannot be confirmed as live.
 *
 * This is the error that protects the only copy of the video: cleanup deletes
 * the render once an upload is verified, so an unverifiable upload must fail
 * loudly rather than be assumed to have worked.
 */
export class PublishNotVerifiedError extends ApplicationError {
  constructor(externalUrl: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.PublishNotVerified,
      message: `The upload was submitted but ${externalUrl} could not be confirmed as live.`,
      retryable: false,
      details: { externalUrl, ...(details ?? {}) },
    });
  }
}
