import type { ErrorCode } from './error-code.js';

/** Arbitrary, JSON-serialisable context attached to an error. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

/** Wire format used when an error is persisted or logged. */
export interface SerializedError {
  readonly name: string;
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: ErrorDetails;
}

/** Constructor input shared by every concrete error. */
export interface ApplicationErrorInput {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: ErrorDetails;
}

/**
 * Base class of every error raised by Yu-tomation.
 *
 * A generic `Error` is never thrown (PROJECT_RULES.md "Error Handling"):
 * the workflow needs `code` to report, `retryable` to decide, and `details`
 * to reproduce.
 */
export abstract class ApplicationError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details: ErrorDetails;

  protected constructor(input: ApplicationErrorInput) {
    super(input.message);
    this.name = new.target.name;
    this.code = input.code;
    this.retryable = input.retryable;
    this.details = input.details ?? {};
  }

  /** Representation stored in `last_error` columns and structured logs. */
  public toJSON(): SerializedError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/** Type guard narrowing an unknown throwable to an {@link ApplicationError}. */
export const isApplicationError = (value: unknown): value is ApplicationError =>
  value instanceof ApplicationError;
