import type { LogEntryDto, NewLogEntryDto } from '../dto/log.dto.js';
import {
  toDbLogLevel,
  toDbWorkflowStepName,
  toLogLevel,
  toWorkflowStepName,
} from '../database/enum.map.js';
import type { LogEntry as LogEntryRecord } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { fromJsonColumn, runQuery, toNullableJsonColumn } from '../database/query.js';

/** Maps a database row onto the domain DTO. */
const toDto = (record: LogEntryRecord): LogEntryDto => ({
  id: record.id,
  correlationId: record.correlationId,
  workflowRunId: record.workflowRunId,
  level: toLogLevel(record.level),
  step: record.step === null ? null : toWorkflowStepName(record.step),
  source: record.source,
  message: record.message,
  durationMs: record.durationMs,
  retryCount: record.retryCount,
  context: fromJsonColumn<Readonly<Record<string, unknown>>>(record.context),
  createdAt: record.createdAt,
});

/**
 * Durable storage for structured log records.
 *
 * Tables
 * - `log_entries`
 *
 * Methods
 * - {@link create}
 * - {@link findByCorrelationId}
 * - {@link deleteOlderThan}
 *
 * Logs are knowledge, not media: they survive the run they describe and are
 * never deleted by the Cleanup Agent. {@link deleteOlderThan} exists for
 * scheduled retention, which is an operational decision, not a pipeline step.
 */
export class LogRepository {
  constructor(private readonly database: Database) {}

  /** Appends one record. */
  public async create(input: NewLogEntryDto): Promise<LogEntryDto> {
    const record = await runQuery('LogRepository.create', () =>
      this.database.logEntry.create({
        data: {
          correlationId: input.correlationId,
          workflowRunId: input.workflowRunId,
          level: toDbLogLevel(input.level),
          step: input.step === null ? null : toDbWorkflowStepName(input.step),
          source: input.source,
          message: input.message,
          durationMs: input.durationMs,
          retryCount: input.retryCount,
          context: toNullableJsonColumn(input.context),
        },
      }),
    );

    return toDto(record);
  }

  /** Returns the trace of a single run, oldest first. */
  public async findByCorrelationId(
    correlationId: string,
    limit: number,
  ): Promise<readonly LogEntryDto[]> {
    const records = await runQuery('LogRepository.findByCorrelationId', () =>
      this.database.logEntry.findMany({
        where: { correlationId },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    );

    return records.map(toDto);
  }

  /** Deletes records created before `cutoff`. Returns how many were removed. */
  public async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await runQuery('LogRepository.deleteOlderThan', () =>
      this.database.logEntry.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    );

    return result.count;
  }
}
