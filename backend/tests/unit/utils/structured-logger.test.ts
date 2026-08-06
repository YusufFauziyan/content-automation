import { describe, expect, it } from 'vitest';

import { LogLevel } from '../../../src/types/logger.js';
import { StructuredLogger, type LogSink } from '../../../src/utils/logger/structured.logger.js';

/** Collects emitted lines so assertions can inspect the serialised record. */
const createSink = (): { sink: LogSink; lines: string[] } => {
  const lines: string[] = [];
  return { sink: { write: (line) => lines.push(line) }, lines };
};

const parse = (line: string): Record<string, unknown> =>
  JSON.parse(line) as Record<string, unknown>;

describe('StructuredLogger', () => {
  it('emits newline-delimited JSON with level and message', () => {
    const { sink, lines } = createSink();

    new StructuredLogger(LogLevel.Debug, {}, sink).info('Workflow started');

    expect(lines).toHaveLength(1);
    expect(parse(lines[0]!)['level']).toBe(LogLevel.Info);
    expect(parse(lines[0]!)['message']).toBe('Workflow started');
  });

  it('discards records below the configured threshold', () => {
    const { sink, lines } = createSink();

    new StructuredLogger(LogLevel.Warn, {}, sink).info('ignored');

    expect(lines).toHaveLength(0);
  });

  it('merges bound context into every record of a child logger', () => {
    const { sink, lines } = createSink();

    new StructuredLogger(LogLevel.Debug, {}, sink)
      .child({ correlationId: 'abc' })
      .info('Step started', { durationMs: 5 });

    expect(parse(lines[0]!)['correlationId']).toBe('abc');
    expect(parse(lines[0]!)['durationMs']).toBe(5);
  });

  it('serialises a typed error into its code and retryable flag', () => {
    const { sink, lines } = createSink();
    const logger = new StructuredLogger(LogLevel.Debug, {}, sink);

    logger.error('Step failed', new RangeError('out of range'));

    const record = parse(lines[0]!);
    expect(record['level']).toBe(LogLevel.Error);
    expect(JSON.stringify(record['error'])).toContain('out of range');
  });
});
