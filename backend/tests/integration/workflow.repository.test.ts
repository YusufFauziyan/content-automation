import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.loader.js';
import { createDatabase, type Database } from '../../src/database/prisma.client.js';
import { WorkflowRepository } from '../../src/repositories/workflow.repository.js';
import { WorkflowStatus, WorkflowStepName, WorkflowStepStatus } from '../../src/types/workflow.js';
import { createCorrelationId } from '../../src/utils/identity/correlation-id.js';

/**
 * Integration coverage for the resume contract.
 *
 * Requires the Docker PostgreSQL instance (`pnpm db:up && pnpm db:migrate`).
 * The suite skips itself when `DATABASE_URL` is absent, so a plain `pnpm test`
 * on a machine without the database still passes. No external API is involved.
 */
const databaseAvailable = process.env['DATABASE_URL'] !== undefined;

describe.skipIf(!databaseAvailable)('WorkflowRepository', () => {
  const createdRunIds: string[] = [];
  let database: Database;
  let repository: WorkflowRepository;

  // Built in a hook rather than at module scope so that collecting this file on
  // a machine without a database does not fail configuration validation. Hooks
  // still run for a skipped suite, hence the guards.
  beforeAll(() => {
    if (!databaseAvailable) {
      return;
    }
    database = createDatabase(loadConfig().database);
    repository = new WorkflowRepository(database);
  });

  afterAll(async () => {
    if (!databaseAvailable) {
      return;
    }
    await database.workflowRun.deleteMany({ where: { id: { in: createdRunIds } } });
    await database.$disconnect();
  });

  it('creates a run in PENDING', async () => {
    const run = await repository.createRun({ correlationId: createCorrelationId() });
    createdRunIds.push(run.id);

    expect(run.status).toBe(WorkflowStatus.Pending);
    expect(run.finishedAt).toBeNull();
  });

  it('finds a run by its correlation id', async () => {
    const correlationId = createCorrelationId();
    const run = await repository.createRun({ correlationId });
    createdRunIds.push(run.id);

    const found = await repository.findRunByCorrelationId(correlationId);

    expect(found?.id).toBe(run.id);
  });

  it('updates a step in place instead of appending a second row', async () => {
    const run = await repository.createRun({ correlationId: createCorrelationId() });
    createdRunIds.push(run.id);

    await repository.recordStep(run.id, WorkflowStepName.Topic, {
      status: WorkflowStepStatus.Running,
      attempt: 1,
    });
    await repository.recordStep(run.id, WorkflowStepName.Topic, {
      status: WorkflowStepStatus.Succeeded,
      attempt: 2,
      durationMs: 42,
    });

    const steps = await repository.findSteps(run.id);

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe(WorkflowStepStatus.Succeeded);
    expect(steps[0]?.attempt).toBe(2);
  });

  it('lists a failed run as resumable', async () => {
    const run = await repository.createRun({ correlationId: createCorrelationId() });
    createdRunIds.push(run.id);

    await repository.updateRun(run.id, { status: WorkflowStatus.Failed });
    const resumable = await repository.findResumableRuns(100);

    expect(resumable.some((candidate) => candidate.id === run.id)).toBe(true);
  });

  it('excludes a completed run from the resumable list', async () => {
    const run = await repository.createRun({ correlationId: createCorrelationId() });
    createdRunIds.push(run.id);

    await repository.updateRun(run.id, {
      status: WorkflowStatus.Completed,
      finishedAt: new Date(),
    });
    const resumable = await repository.findResumableRuns(100);

    expect(resumable.some((candidate) => candidate.id === run.id)).toBe(false);
  });
});
