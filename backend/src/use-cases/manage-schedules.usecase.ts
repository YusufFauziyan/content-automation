import type { NewScheduleDto, ScheduleDto, ScheduleEditDto } from '../dto/schedule.dto.js';
import type { ScheduleRepository } from '../repositories/schedule.repository.js';
import { RecordNotFoundError } from '../types/errors/persistence.error.js';
import type { Logger } from '../types/logger.js';

/** Bounds an operator can set. Below the floor a run would overlap itself. */
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 60 * 24 * 30;

const MINUTE_MS = 60_000;

/** The business operations for keeping a set of schedules. */
export class ManageSchedulesUseCase {
  constructor(
    private readonly scheduleRepository: ScheduleRepository,
    private readonly logger: Logger,
  ) {}

  public list(): Promise<readonly ScheduleDto[]> {
    return this.scheduleRepository.findAll();
  }

  public async create(input: NewScheduleDto): Promise<ScheduleDto> {
    const intervalMinutes = Math.min(
      Math.max(Math.round(input.intervalMinutes), MIN_INTERVAL_MINUTES),
      MAX_INTERVAL_MINUTES,
    );

    const schedule = await this.scheduleRepository.create({ ...input, intervalMinutes });

    this.logger.info('Schedule created', {
      source: ManageSchedulesUseCase.name,
      scheduleId: schedule.id,
      intervalMinutes,
    });

    return schedule;
  }

  /**
   * Changes a schedule after it exists.
   *
   * A new interval moves the next firing: leaving it where it was would mean
   * "every hour from now on" still waited out the six hours the old setting had
   * already committed to. It is measured from the last firing, or from now for
   * a schedule that has never fired, so shortening an interval brings the next
   * video forward rather than firing one immediately.
   *
   * @throws {RecordNotFoundError} When no schedule carries that id.
   */
  public async edit(id: string, changes: ScheduleEditDto): Promise<ScheduleDto> {
    const existing = await this.scheduleRepository.findById(id);

    if (existing === null) {
      throw new RecordNotFoundError('Schedule', id);
    }

    const update: { -readonly [K in keyof ScheduleEditDto]: ScheduleEditDto[K] } & {
      nextRunAt?: Date;
    } = {};

    if (changes.name !== undefined && changes.name.trim() !== '') {
      update.name = changes.name.trim();
    }
    if (changes.language !== undefined && changes.language.trim() !== '') {
      update.language = changes.language.trim();
    }
    if (changes.enabled !== undefined) {
      update.enabled = changes.enabled;
    }

    if (changes.intervalMinutes !== undefined) {
      const intervalMinutes = Math.min(
        Math.max(Math.round(changes.intervalMinutes), MIN_INTERVAL_MINUTES),
        MAX_INTERVAL_MINUTES,
      );

      if (intervalMinutes !== existing.intervalMinutes) {
        update.intervalMinutes = intervalMinutes;
        update.nextRunAt = new Date(
          (existing.lastRunAt ?? new Date()).getTime() + intervalMinutes * MINUTE_MS,
        );
      }
    }

    this.logger.info('Schedule changed', {
      source: ManageSchedulesUseCase.name,
      scheduleId: id,
      changed: Object.keys(update),
    });

    return this.scheduleRepository.update(id, update);
  }

  /**
   * @throws {RecordNotFoundError} When no schedule carries that id.
   */
  public setEnabled(id: string, enabled: boolean): Promise<ScheduleDto> {
    return this.edit(id, { enabled });
  }

  public async remove(ids: readonly string[]): Promise<number> {
    const deleted = await this.scheduleRepository.delete(ids);

    this.logger.info('Schedules deleted', {
      source: ManageSchedulesUseCase.name,
      deleted,
    });

    return deleted;
  }
}
