import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import type { NewScheduleDto, ScheduleDto, ScheduleUpdateDto } from '../dto/schedule.dto.js';

/** Maps a database row onto the domain DTO. */
const toDto = (record: {
  id: string;
  name: string;
  language: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  runsStarted: number;
  lastError: string | null;
  createdAt: Date;
}): ScheduleDto => ({
  id: record.id,
  name: record.name,
  language: record.language,
  intervalMinutes: record.intervalMinutes,
  enabled: record.enabled,
  nextRunAt: record.nextRunAt,
  lastRunAt: record.lastRunAt,
  runsStarted: record.runsStarted,
  lastError: record.lastError,
  createdAt: record.createdAt,
});

const MINUTE_MS = 60_000;

/**
 * Standing instructions to produce videos.
 *
 * Table
 * - `schedules`
 *
 * Methods
 * - {@link create}, {@link findAll}, {@link findDue}, {@link update}, {@link delete}
 *
 * Holds no topic: what a schedule makes is decided when it fires, not when it
 * is written.
 */
export class ScheduleRepository {
  constructor(private readonly database: Database) {}

  public async create(input: NewScheduleDto): Promise<ScheduleDto> {
    const record = await runQuery('ScheduleRepository.create', () =>
      this.database.schedule.create({
        data: {
          name: input.name,
          language: input.language,
          intervalMinutes: input.intervalMinutes,
          nextRunAt: input.nextRunAt ?? new Date(Date.now() + input.intervalMinutes * MINUTE_MS),
        },
      }),
    );

    return toDto(record);
  }

  /** Newest first, which is the order an operator added them in. */
  public async findAll(): Promise<readonly ScheduleDto[]> {
    const records = await runQuery('ScheduleRepository.findAll', () =>
      this.database.schedule.findMany({ orderBy: { createdAt: 'desc' } }),
    );

    return records.map(toDto);
  }

  /**
   * Enabled schedules whose time has come.
   *
   * Ordered oldest-due first so a backlog is worked through in the order it
   * accumulated rather than by whichever row the database returns.
   */
  public async findDue(now: Date, limit: number): Promise<readonly ScheduleDto[]> {
    const records = await runQuery('ScheduleRepository.findDue', () =>
      this.database.schedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: 'asc' },
        take: limit,
      }),
    );

    return records.map(toDto);
  }

  public async findById(id: string): Promise<ScheduleDto | null> {
    const record = await runQuery('ScheduleRepository.findById', () =>
      this.database.schedule.findUnique({ where: { id } }),
    );

    return record === null ? null : toDto(record);
  }

  public async update(id: string, input: ScheduleUpdateDto): Promise<ScheduleDto> {
    const record = await runQuery('ScheduleRepository.update', () =>
      this.database.schedule.update({ where: { id }, data: { ...input } }),
    );

    return toDto(record);
  }

  public async delete(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const { count } = await runQuery('ScheduleRepository.delete', () =>
      this.database.schedule.deleteMany({ where: { id: { in: [...ids] } } }),
    );

    return count;
  }
}
