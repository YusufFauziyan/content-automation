import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import type { Logger } from '../types/logger.js';

export interface DeleteRunsRequest {
  readonly runIds: readonly string[];
}

export interface DeleteRunsResult {
  readonly deleted: number;
  /** Runs that were left alone because they are still going. */
  readonly skipped: readonly string[];
}

/** Nothing larger than this in one call, so a mis-click cannot empty the table. */
const MAX_PER_CALL = 100;

/**
 * How long a started run may go without finishing before it counts as
 * abandoned rather than active.
 *
 * There is no heartbeat: a run that crashed looks exactly like one that is
 * working, both being "started, not finished". Without this window a crashed
 * run could never be deleted, which is the opposite of useful — those are
 * precisely the rows an operator wants to clear.
 */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

/**
 * The business operation "forget these runs".
 *
 * A run that is still executing is never deleted: its workflow is mid-flight
 * and would go on writing rows for something the operator believes is gone.
 * Those ids come back in `skipped` rather than failing the whole call, because
 * a bulk delete of thirty runs should not be refused because one of them
 * started a second ago.
 */
export class DeleteRunsUseCase {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(request: DeleteRunsRequest): Promise<DeleteRunsResult> {
    const ids = [...new Set(request.runIds)].slice(0, MAX_PER_CALL);
    const deletable: string[] = [];
    const skipped: string[] = [];

    for (const id of ids) {
      const run = await this.workflowRepository.findRunById(id);

      if (run === null) continue;

      // Only a *recently* started, unfinished run is treated as in flight.
      const inFlight =
        run.startedAt !== null &&
        run.finishedAt === null &&
        Date.now() - run.startedAt.getTime() < ABANDONED_AFTER_MS;

      if (inFlight) {
        skipped.push(id);
        continue;
      }

      deletable.push(id);
    }

    const deleted = await this.workflowRepository.deleteRuns(deletable);

    this.logger.info('Runs deleted', {
      source: DeleteRunsUseCase.name,
      requested: ids.length,
      deleted,
      skipped: skipped.length,
    });

    return { deleted, skipped };
  }
}
