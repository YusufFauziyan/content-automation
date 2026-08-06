import { isApplicationError } from '../../types/errors/application.error.js';
import { LOG_LEVEL_SEVERITY, LogLevel, type LogContext, type Logger } from '../../types/logger.js';

/** Destination a {@link StructuredLogger} writes serialised records to. */
export interface LogSink {
  write(line: string): void;
}

/** Writes to the process streams; errors and warnings go to stderr. */
export const processStreamSink: LogSink = {
  write(line: string): void {
    process.stdout.write(`${line}\n`);
  },
};

/** Shape of one emitted record. */
interface LogRecord extends LogContext {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
}

/** Reduces an unknown throwable to something JSON can carry. */
const describeError = (error: unknown): unknown => {
  if (isApplicationError(error)) {
    return error.toJSON();
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
};

/**
 * Newline-delimited JSON logger.
 *
 * Structured output is a hard requirement rather than a preference: every
 * record carries the correlation id and workflow id needed to reconstruct a
 * crashed run, which a formatted string cannot guarantee.
 */
export class StructuredLogger implements Logger {
  private readonly threshold: number;

  constructor(
    private readonly level: LogLevel,
    private readonly bindings: LogContext = {},
    private readonly sink: LogSink = processStreamSink,
  ) {
    this.threshold = LOG_LEVEL_SEVERITY[level];
  }

  public debug(message: string, context?: LogContext): void {
    this.emit(LogLevel.Debug, message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.emit(LogLevel.Info, message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.emit(LogLevel.Warn, message, context);
  }

  public error(message: string, error?: unknown, context?: LogContext): void {
    const enriched: LogContext =
      error === undefined ? { ...context } : { ...context, error: describeError(error) };

    this.emit(LogLevel.Error, message, enriched);
  }

  public child(context: LogContext): Logger {
    return new StructuredLogger(this.level, { ...this.bindings, ...context }, this.sink);
  }

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_SEVERITY[level] < this.threshold) {
      return;
    }

    const record: LogRecord = {
      ...this.bindings,
      ...context,
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    this.sink.write(JSON.stringify(record));
  }
}
