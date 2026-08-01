import type { LogLevel } from '../types/logger.js';
import type { WorkflowStepName } from '../types/workflow.js';

/** Input accepted by `LogRepository.create`. */
export interface NewLogEntryDto {
  readonly correlationId: string;
  readonly workflowRunId: string | null;
  readonly level: LogLevel;
  readonly step: WorkflowStepName | null;
  /** Emitting component, e.g. `"TopicAgent"`. */
  readonly source: string | null;
  readonly message: string;
  readonly durationMs: number | null;
  readonly retryCount: number | null;
  readonly context: Readonly<Record<string, unknown>> | null;
}

/** A persisted log record. */
export interface LogEntryDto extends NewLogEntryDto {
  readonly id: string;
  readonly createdAt: Date;
}
