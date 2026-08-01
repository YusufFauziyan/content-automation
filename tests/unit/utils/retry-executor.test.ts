import { describe, expect, it } from 'vitest';

import type { WorkflowConfig } from '../../../src/config/app.config.js';
import { ApplicationError } from '../../../src/types/errors/application.error.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NotImplementedError } from '../../../src/types/errors/not-implemented.error.js';
import { fail, ok, type Result } from '../../../src/types/result.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { RetryExecutor } from '../../../src/utils/retry/retry-executor.js';

/** Retryable failure used to drive the executor. */
class TransientError extends ApplicationError {
  constructor() {
    super({ code: ErrorCode.PersistenceFailure, message: 'transient', retryable: true });
  }
}

/** Backoff of 1ms keeps the test fast while exercising the real delay path. */
const CONFIG: WorkflowConfig = { maxRetries: 2, backoffMs: [1, 1] };

const createExecutor = (): RetryExecutor => new RetryExecutor(CONFIG, new NoopLogger());

describe('RetryExecutor', () => {
  it('returns the first success without retrying', async () => {
    let calls = 0;
    const result = await createExecutor().execute('STEP', () => {
      calls += 1;
      return Promise.resolve(ok('done'));
    });

    expect(result).toEqual({ success: true, data: 'done' });
    expect(calls).toBe(1);
  });

  it('retries a retryable failure up to the configured budget', async () => {
    let calls = 0;
    const result = await createExecutor().execute('STEP', () => {
      calls += 1;
      return Promise.resolve(fail(new TransientError()));
    });

    expect(result.success).toBe(false);
    expect(calls).toBe(CONFIG.maxRetries + 1);
  });

  it('stops as soon as an attempt succeeds', async () => {
    let calls = 0;
    const result = await createExecutor().execute('STEP', (attempt): Promise<Result<string>> => {
      calls += 1;
      return Promise.resolve(attempt < 2 ? fail(new TransientError()) : ok('recovered'));
    });

    expect(result).toEqual({ success: true, data: 'recovered' });
    expect(calls).toBe(2);
  });

  it('does not retry a non-retryable failure', async () => {
    let calls = 0;
    const result = await createExecutor().execute('STEP', () => {
      calls += 1;
      return Promise.resolve(fail(new NotImplementedError('Step')));
    });

    expect(result.success).toBe(false);
    expect(calls).toBe(1);
  });
});
