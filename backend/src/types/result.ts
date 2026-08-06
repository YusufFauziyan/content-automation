import type { ApplicationError } from './errors/application.error.js';

/**
 * Outcome of an operation that is expected to fail as part of normal
 * behaviour.
 *
 * Agents return a `Result` instead of throwing, so the workflow can inspect
 * `error.retryable` and decide between retry and abort without unwinding the
 * stack (see ARCHITECTURE.md "Error Recovery").
 */
export type Result<TValue, TError extends ApplicationError = ApplicationError> =
  | { readonly success: true; readonly data: TValue }
  | { readonly success: false; readonly error: TError };

/** Builds a successful {@link Result}. */
export const ok = <TValue>(data: TValue): Result<TValue, never> => ({ success: true, data });

/** Builds a failed {@link Result}. */
export const fail = <TError extends ApplicationError>(error: TError): Result<never, TError> => ({
  success: false,
  error,
});
