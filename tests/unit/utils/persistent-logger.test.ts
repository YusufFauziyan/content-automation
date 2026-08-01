import { describe, expect, it } from 'vitest';

import type { LogEntryDto, NewLogEntryDto } from '../../../src/dto/log.dto.js';
import type { LogRepository } from '../../../src/repositories/log.repository.js';
import { LogLevel } from '../../../src/types/logger.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { PersistentLogger } from '../../../src/utils/logger/persistent.logger.js';
import { asFake } from '../../support/fakes.js';

/** A repository whose writes only settle when the test releases them. */
const deferredRepository = (
  written: NewLogEntryDto[],
): { repository: LogRepository; release: () => void } => {
  const pending: (() => void)[] = [];

  const repository = asFake<LogRepository>({
    create: (input) => {
      written.push(input);

      return new Promise<LogEntryDto>((resolve) => {
        pending.push(() => {
          resolve(asFake<LogEntryDto>({ id: 'log-1' }));
        });
      });
    },
  });

  return {
    repository,
    release: () => {
      for (const settle of pending.splice(0)) {
        settle();
      }
    },
  };
};

describe('PersistentLogger', () => {
  it('mirrors a record into the repository', async () => {
    const written: NewLogEntryDto[] = [];
    const { repository, release } = deferredRepository(written);
    const logger = new PersistentLogger(new NoopLogger(), repository, LogLevel.Debug);

    logger.info('Step started', { correlationId: 'run-1', source: 'TopicAgent' });
    release();
    await logger.flush();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ correlationId: 'run-1', source: 'TopicAgent' });
  });

  it('skips a record that cannot be attributed to a run', async () => {
    const written: NewLogEntryDto[] = [];
    const { repository } = deferredRepository(written);
    const logger = new PersistentLogger(new NoopLogger(), repository, LogLevel.Debug);

    logger.info('No correlation id here');
    await logger.flush();

    expect(written).toHaveLength(0);
  });

  it('waits for in-flight writes so none outlives the connection pool', async () => {
    const written: NewLogEntryDto[] = [];
    const { repository, release } = deferredRepository(written);
    const logger = new PersistentLogger(new NoopLogger(), repository, LogLevel.Debug);

    logger.info('One', { correlationId: 'run-1' });
    logger.info('Two', { correlationId: 'run-1' });

    let flushed = false;
    const flushing = logger.flush().then(() => {
      flushed = true;
    });

    // Nothing has settled yet, so the flush must still be waiting.
    await Promise.resolve();
    expect(flushed).toBe(false);

    release();
    await flushing;

    expect(flushed).toBe(true);
  });

  it('flushes writes started by a child logger too', async () => {
    const written: NewLogEntryDto[] = [];
    const { repository, release } = deferredRepository(written);
    const logger = new PersistentLogger(new NoopLogger(), repository, LogLevel.Debug);

    logger.child({ correlationId: 'run-1' }).info('From a child');

    let flushed = false;
    const flushing = logger.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);

    release();
    await flushing;

    expect(written).toHaveLength(1);
  });

  it('returns immediately when nothing is in flight', async () => {
    const { repository } = deferredRepository([]);
    const logger = new PersistentLogger(new NoopLogger(), repository, LogLevel.Debug);

    await expect(logger.flush()).resolves.toBeUndefined();
  });
});
