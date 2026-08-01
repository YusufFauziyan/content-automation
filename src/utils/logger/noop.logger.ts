import type { LogContext, Logger } from '../../types/logger.js';

/**
 * Logger that discards everything.
 *
 * Injected by unit tests so a test run produces no output and no assertions
 * accidentally depend on logging.
 */
export class NoopLogger implements Logger {
  public debug(): void {
    // intentionally empty
  }

  public info(): void {
    // intentionally empty
  }

  public warn(): void {
    // intentionally empty
  }

  public error(): void {
    // intentionally empty
  }

  public child(_context: LogContext): Logger {
    return this;
  }
}
