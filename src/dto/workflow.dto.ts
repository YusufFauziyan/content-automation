import type { SerializedError } from '../types/errors/application.error.js';
import type { WorkflowStatus, WorkflowStepName, WorkflowStepStatus } from '../types/workflow.js';

/** Input accepted by `WorkflowRepository.createRun`. */
export interface NewWorkflowRunDto {
  readonly correlationId: string;
}

/** Fields that may change while a run progresses. */
export interface WorkflowRunUpdateDto {
  readonly status?: WorkflowStatus;
  readonly topicId?: string;
  readonly contentId?: string;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly lastError?: SerializedError | null;
}

/** A persisted end-to-end pipeline execution. */
export interface WorkflowRunDto {
  readonly id: string;
  readonly correlationId: string;
  readonly status: WorkflowStatus;
  readonly topicId: string | null;
  readonly contentId: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly lastError: SerializedError | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Fields recorded for a single step attempt. */
export interface WorkflowStepUpdateDto {
  readonly status: WorkflowStepStatus;
  readonly attempt?: number;
  readonly durationMs?: number;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly lastError?: SerializedError | null;
}

/** A persisted step attempt; the unit the workflow resumes from. */
export interface WorkflowStepRunDto {
  readonly id: string;
  readonly workflowRunId: string;
  readonly step: WorkflowStepName;
  readonly status: WorkflowStepStatus;
  readonly attempt: number;
  readonly durationMs: number | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly lastError: SerializedError | null;
}
