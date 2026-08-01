import type { WorkflowStepName } from './workflow.js';

/** Severity of a log record. */
export enum LogLevel {
  Debug = 'DEBUG',
  Info = 'INFO',
  Warn = 'WARN',
  Error = 'ERROR',
}

/** Ordering used to decide whether a record passes the configured threshold. */
export const LOG_LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  [LogLevel.Debug]: 10,
  [LogLevel.Info]: 20,
  [LogLevel.Warn]: 30,
  [LogLevel.Error]: 40,
};

/**
 * Structured fields attached to a log record.
 *
 * `correlationId` and `workflowRunId` are the fields that make a crashed run
 * reconstructible, so every workflow-scoped logger binds them once via
 * {@link Logger.child}.
 */
export interface LogContext {
  readonly correlationId?: string;
  readonly workflowRunId?: string;
  readonly step?: WorkflowStepName;
  /** Emitting component, e.g. `"TopicAgent"`. */
  readonly source?: string;
  readonly durationMs?: number;
  readonly retryCount?: number;
  readonly [key: string]: unknown;
}

/**
 * The only sanctioned way to emit diagnostics. `console.log` is forbidden by
 * lint, because it cannot carry a correlation id and cannot be persisted.
 */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;

  /**
   * Returns a logger that merges `context` into every record it emits.
   * Used to bind the correlation id at the start of a workflow run.
   */
  child(context: LogContext): Logger;
}
