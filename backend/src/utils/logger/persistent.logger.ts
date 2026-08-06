import { LOG_LEVEL_SEVERITY, LogLevel, type LogContext, type Logger } from '../../types/logger.js';
import type { LogRepository } from '../../repositories/log.repository.js';

/** Context keys that map onto dedicated columns of `log_entries`. */
interface PromotedFields {
  readonly correlationId?: string;
  readonly workflowRunId?: string;
  readonly step?: LogContext['step'];
  readonly source?: string;
  readonly durationMs?: number;
  readonly retryCount?: number;
}

const PROMOTED_KEYS = [
  'correlationId',
  'workflowRunId',
  'step',
  'source',
  'durationMs',
  'retryCount',
] as const;

/** Splits a context into the promoted columns and the remaining free-form JSON. */
const splitContext = (
  context: LogContext,
): { promoted: PromotedFields; remainder: Record<string, unknown> | null } => {
  const remainder: Record<string, unknown> = {};
  const promoted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if ((PROMOTED_KEYS as readonly string[]).includes(key)) {
      promoted[key] = value;
    } else {
      remainder[key] = value;
    }
  }

  return {
    promoted: promoted,
    remainder: Object.keys(remainder).length === 0 ? null : remainder,
  };
};

/**
 * Decorator that mirrors every record into PostgreSQL.
 *
 * A decorator rather than a second logger implementation: the stdout logger
 * stays the single source of formatting, and persistence can be switched off
 * per environment (`LOG_PERSIST`) by simply not wrapping.
 *
 * Records without a correlation id are not persisted — a log line that cannot
 * be attributed to a run is noise in a table meant for reconstructing runs.
 *
 * Writes are fire-and-forget: logging must never delay or fail the pipeline. A
 * failed write is reported through the delegate and otherwise ignored.
 */
export class PersistentLogger implements Logger {
  /**
   * Writes that have been started but not yet acknowledged.
   *
   * Shared with every child logger, so {@link flush} settles the whole tree.
   */
  private readonly inFlight: Set<Promise<unknown>>;

  constructor(
    private readonly delegate: Logger,
    private readonly logRepository: LogRepository,
    private readonly minLevel: LogLevel,
    private readonly bindings: LogContext = {},
    inFlight?: Set<Promise<unknown>>,
  ) {
    this.inFlight = inFlight ?? new Set();
  }

  public debug(message: string, context?: LogContext): void {
    this.delegate.debug(message, context);
    this.persist(LogLevel.Debug, message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.delegate.info(message, context);
    this.persist(LogLevel.Info, message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.delegate.warn(message, context);
    this.persist(LogLevel.Warn, message, context);
  }

  public error(message: string, error?: unknown, context?: LogContext): void {
    this.delegate.error(message, error, context);
    this.persist(LogLevel.Error, message, context);
  }

  public child(context: LogContext): Logger {
    return new PersistentLogger(
      this.delegate.child(context),
      this.logRepository,
      this.minLevel,
      { ...this.bindings, ...context },
      this.inFlight,
    );
  }

  /**
   * Waits for every started write to settle.
   *
   * Fire-and-forget writes are what keep logging off the pipeline's critical
   * path, but they are also why the last few records of a run can outlive the
   * run: closing the connection pool underneath them produced a genuine
   * "cannot use a pool after calling end" error. Shutdown awaits this first.
   */
  public async flush(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private persist(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this.minLevel]) {
      return;
    }

    const { promoted, remainder } = splitContext({ ...this.bindings, ...context });

    if (promoted.correlationId === undefined) {
      return;
    }

    const write = this.logRepository
      .create({
        correlationId: promoted.correlationId,
        workflowRunId: promoted.workflowRunId ?? null,
        level,
        step: promoted.step ?? null,
        source: promoted.source ?? null,
        message,
        durationMs: promoted.durationMs ?? null,
        retryCount: promoted.retryCount ?? null,
        context: remainder,
      })
      .catch((error: unknown) => {
        this.delegate.error('Failed to persist log record', error, { source: 'PersistentLogger' });
      })
      .finally(() => {
        this.inFlight.delete(write);
      });

    this.inFlight.add(write);
  }
}
