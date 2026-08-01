import type {
  NewWorkflowRunDto,
  WorkflowRunDto,
  WorkflowRunUpdateDto,
  WorkflowStepRunDto,
  WorkflowStepUpdateDto,
} from '../dto/workflow.dto.js';
import {
  toDbWorkflowStatus,
  toDbWorkflowStepName,
  toDbWorkflowStepStatus,
  toWorkflowStatus,
  toWorkflowStepName,
  toWorkflowStepStatus,
} from '../database/enum.map.js';
import type {
  Prisma,
  WorkflowRun as WorkflowRunRecord,
  WorkflowStepRun as WorkflowStepRunRecord,
} from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { fromJsonColumn, runQuery, toNullableJsonColumn } from '../database/query.js';
import type { SerializedError } from '../types/errors/application.error.js';
import { WorkflowStatus, type WorkflowStepName } from '../types/workflow.js';

/** Maps a run row onto the domain DTO. */
const toRunDto = (record: WorkflowRunRecord): WorkflowRunDto => ({
  id: record.id,
  correlationId: record.correlationId,
  status: toWorkflowStatus(record.status),
  topicId: record.topicId,
  contentId: record.contentId,
  startedAt: record.startedAt,
  finishedAt: record.finishedAt,
  lastError: fromJsonColumn<SerializedError>(record.lastError),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/** Maps a step row onto the domain DTO. */
const toStepDto = (record: WorkflowStepRunRecord): WorkflowStepRunDto => ({
  id: record.id,
  workflowRunId: record.workflowRunId,
  step: toWorkflowStepName(record.step),
  status: toWorkflowStepStatus(record.status),
  attempt: record.attempt,
  durationMs: record.durationMs,
  startedAt: record.startedAt,
  finishedAt: record.finishedAt,
  lastError: fromJsonColumn<SerializedError>(record.lastError),
});

/**
 * Persistence for workflow progress — the state that makes a crashed run
 * resumable instead of restartable.
 *
 * Tables
 * - `workflow_runs`
 * - `workflow_step_runs`
 *
 * Methods
 * - {@link createRun}
 * - {@link findRunById}
 * - {@link findRunByCorrelationId}
 * - {@link updateRun}
 * - {@link recordStep}
 * - {@link findSteps}
 *
 * `workflow_step_runs` carries a unique constraint on `(workflow_run_id, step)`,
 * so {@link recordStep} is an upsert: a retried step updates its own row rather
 * than appending a second one.
 */
export class WorkflowRepository {
  constructor(private readonly database: Database) {}

  /** Opens a new run in `PENDING`. */
  public async createRun(input: NewWorkflowRunDto): Promise<WorkflowRunDto> {
    const record = await runQuery('WorkflowRepository.createRun', () =>
      this.database.workflowRun.create({
        data: { correlationId: input.correlationId },
      }),
    );

    return toRunDto(record);
  }

  /** Returns the run, or `null` when the id is unknown. */
  public async findRunById(id: string): Promise<WorkflowRunDto | null> {
    const record = await runQuery('WorkflowRepository.findRunById', () =>
      this.database.workflowRun.findUnique({ where: { id } }),
    );

    return record === null ? null : toRunDto(record);
  }

  /** Lookup used when resuming an interrupted run. */
  public async findRunByCorrelationId(correlationId: string): Promise<WorkflowRunDto | null> {
    const record = await runQuery('WorkflowRepository.findRunByCorrelationId', () =>
      this.database.workflowRun.findUnique({ where: { correlationId } }),
    );

    return record === null ? null : toRunDto(record);
  }

  /**
   * Returns runs that are unfinished or that finished by failing, oldest first.
   *
   * A run that stopped deliberately at a requested step has `finished_at` set
   * and is therefore not a recovery candidate; a crashed process leaves that
   * column null, which is exactly what identifies it. Which of these is worth
   * resuming is decided by `RetryWorkflow`.
   */
  public async findResumableRuns(limit: number): Promise<readonly WorkflowRunDto[]> {
    const records = await runQuery('WorkflowRepository.findResumableRuns', () =>
      this.database.workflowRun.findMany({
        where: {
          OR: [{ finishedAt: null }, { status: toDbWorkflowStatus(WorkflowStatus.Failed) }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    );

    return records.map(toRunDto);
  }

  /** Applies a partial update. Fields left out are untouched. */
  public async updateRun(id: string, input: WorkflowRunUpdateDto): Promise<WorkflowRunDto> {
    const data: Prisma.WorkflowRunUpdateInput = {};

    if (input.status !== undefined) {
      data.status = toDbWorkflowStatus(input.status);
    }
    if (input.topicId !== undefined) {
      data.topic = { connect: { id: input.topicId } };
    }
    if (input.contentId !== undefined) {
      data.content = { connect: { id: input.contentId } };
    }
    if (input.startedAt !== undefined) {
      data.startedAt = input.startedAt;
    }
    if (input.finishedAt !== undefined) {
      data.finishedAt = input.finishedAt;
    }
    if (input.lastError !== undefined) {
      data.lastError = toNullableJsonColumn(input.lastError);
    }

    const record = await runQuery('WorkflowRepository.updateRun', () =>
      this.database.workflowRun.update({ where: { id }, data }),
    );

    return toRunDto(record);
  }

  /**
   * Writes the outcome of a step attempt, creating the row on first use.
   *
   * @param workflowRunId Run the step belongs to.
   * @param step          Step being recorded.
   * @param input         Attempt outcome.
   */
  public async recordStep(
    workflowRunId: string,
    step: WorkflowStepName,
    input: WorkflowStepUpdateDto,
  ): Promise<WorkflowStepRunDto> {
    const status = toDbWorkflowStepStatus(input.status);
    const dbStep = toDbWorkflowStepName(step);

    const mutable: Prisma.WorkflowStepRunUpdateInput = { status };

    if (input.attempt !== undefined) {
      mutable.attempt = input.attempt;
    }
    if (input.durationMs !== undefined) {
      mutable.durationMs = input.durationMs;
    }
    if (input.startedAt !== undefined) {
      mutable.startedAt = input.startedAt;
    }
    if (input.finishedAt !== undefined) {
      mutable.finishedAt = input.finishedAt;
    }
    if (input.lastError !== undefined) {
      mutable.lastError = toNullableJsonColumn(input.lastError);
    }

    const record = await runQuery('WorkflowRepository.recordStep', () =>
      this.database.workflowStepRun.upsert({
        where: { workflowRunId_step: { workflowRunId, step: dbStep } },
        create: {
          workflowRunId,
          step: dbStep,
          status,
          attempt: input.attempt ?? 0,
          durationMs: input.durationMs ?? null,
          startedAt: input.startedAt ?? null,
          finishedAt: input.finishedAt ?? null,
          lastError: toNullableJsonColumn(input.lastError ?? null),
        },
        update: mutable,
      }),
    );

    return toStepDto(record);
  }

  /** Returns every recorded step of a run, in creation order. */
  public async findSteps(workflowRunId: string): Promise<readonly WorkflowStepRunDto[]> {
    const records = await runQuery('WorkflowRepository.findSteps', () =>
      this.database.workflowStepRun.findMany({
        where: { workflowRunId },
        orderBy: { createdAt: 'asc' },
      }),
    );

    return records.map(toStepDto);
  }
}
