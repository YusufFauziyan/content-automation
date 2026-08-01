import { sleep } from './sleep.js';
import type { WorkflowConfig } from '../../config/app.config.js';
import type { LogContext, Logger } from '../../types/logger.js';
import type { Result } from '../../types/result.js';

/** An attempt of a retryable operation. `attempt` is 1-based. */
export type RetryableOperation<TValue> = (attempt: number) => Promise<Result<TValue>>;

/**
 * Applies the project-wide retry policy to a single operation.
 *
 * Only failures whose error is marked `retryable` are attempted again — a
 * validation failure or a missing configuration will not become correct by
 * running it a second time (PROJECT_RULES.md "Retry Policy").
 *
 * Delays come from configuration, never from constants in code, so the policy
 * can be tuned per environment without a release.
 */
export class RetryExecutor {
  constructor(
    private readonly config: WorkflowConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs `operation` until it succeeds, until a non-retryable failure occurs,
   * or until the retry budget is exhausted.
   *
   * @param operationName Name used in log records, e.g. `"TOPIC"`.
   * @param operation     The work to attempt.
   * @param context       Additional fields for every log record emitted here.
   * @returns The first success, or the last failure.
   */
  public async execute<TValue>(
    operationName: string,
    operation: RetryableOperation<TValue>,
    context: LogContext = {},
  ): Promise<Result<TValue>> {
    const maxAttempts = this.config.maxRetries + 1;
    let lastResult = await operation(1);

    for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
      if (lastResult.success || !lastResult.error.retryable) {
        return lastResult;
      }

      const delayMs = this.delayForRetry(attempt - 1);

      this.logger.warn(`${operationName} failed, retrying`, {
        ...context,
        retryCount: attempt - 1,
        delayMs,
        errorCode: lastResult.error.code,
      });

      await sleep(delayMs);
      lastResult = await operation(attempt);
    }

    return lastResult;
  }

  /**
   * Backoff for the given 1-based retry number. Retries beyond the configured
   * list reuse the final delay rather than falling back to zero.
   */
  private delayForRetry(retryNumber: number): number {
    const { backoffMs } = this.config;
    return backoffMs[retryNumber - 1] ?? backoffMs[backoffMs.length - 1] ?? 0;
  }
}
