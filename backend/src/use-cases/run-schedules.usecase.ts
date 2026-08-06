import type { ScheduleDto } from '../dto/schedule.dto.js';
import type { ScheduleRepository } from '../repositories/schedule.repository.js';
import { ErrorCode } from '../types/errors/error-code.js';
import type { Logger } from '../types/logger.js';
import type { GenerateContentUseCase } from './generate-content.usecase.js';
import { ANGLES } from '../workflows/suggest-topics.workflow.js';
import type { SuggestTopicsUseCase } from './suggest-topics.usecase.js';

export interface ScheduleTickResult {
  readonly fired: number;
  readonly started: number;
}

const MINUTE_MS = 60_000;

/** Fired per tick at most, so a long outage cannot start fifty runs at once. */
const MAX_PER_TICK = 3;

/** Suggestions asked for at a time. */
const IDEAS_PER_ROUND = 5;

/**
 * How many areas a firing will search before it accepts there is nothing new.
 *
 * Each round asks about a *different* corner of knowledge, so this is not the
 * same question repeated: asked without an area a model returns the same
 * favourites however often it is asked, and a schedule that keeps running would
 * eventually collide with its own library and stall. Working through the areas
 * is what makes the supply of subjects effectively endless.
 *
 * Bounded only because each round is a model call. Exhausting every area means
 * the library genuinely covers that much ground, and saying so beats spending
 * tokens to rediscover it — the next firing starts from a different area
 * anyway, because the order is shuffled.
 */
const ROUNDS_PER_FIRING = ANGLES.length;

/** Used only if the area list is ever emptied; the type cannot rule that out. */
const FALLBACK_ANGLE = 'interesting knowledge';

/** Spoken length every scheduled video is written for. */
const DURATION_SECONDS = 45;

/**
 * The business operation "make the videos that are due".
 *
 * Called on a timer by the process that serves the API. Each firing asks for
 * fresh subjects, takes the first that is not already in the library, and
 * starts a run from it.
 *
 * Duplicate rejection is not reimplemented here. The Topic Agent already owns
 * that rule — exact title and semantic similarity — and a schedule goes through
 * the same path a person does, so the two cannot drift apart. What this adds is
 * only the patience to try the next idea when one is refused.
 */
export class RunSchedulesUseCase {
  /**
   * True while a tick is working.
   *
   * A firing runs the whole pipeline and takes minutes, while the timer that
   * calls this fires every minute. Without this guard the ticks overlap, and
   * two pipelines writing to one workspace is exactly what produced an MP4 with
   * two `moov` atoms — a file no player would open.
   */
  private working = false;

  constructor(
    private readonly scheduleRepository: ScheduleRepository,
    private readonly suggestTopicsUseCase: SuggestTopicsUseCase,
    private readonly generateContentUseCase: GenerateContentUseCase,
    private readonly logger: Logger,
  ) {}

  public async tick(now: Date = new Date()): Promise<ScheduleTickResult> {
    if (this.working) {
      this.logger.debug('Skipping a tick: the previous one is still working', {
        source: RunSchedulesUseCase.name,
      });
      return { fired: 0, started: 0 };
    }

    this.working = true;

    try {
      return await this.run(now);
    } finally {
      this.working = false;
    }
  }

  private async run(now: Date): Promise<ScheduleTickResult> {
    const due = await this.scheduleRepository.findDue(now, MAX_PER_TICK);
    let started = 0;

    for (const schedule of due) {
      // Advanced before the attempt, not after. A firing that throws must not
      // leave the schedule due for ever, retrying on every tick.
      await this.scheduleRepository.update(schedule.id, {
        nextRunAt: new Date(now.getTime() + schedule.intervalMinutes * MINUTE_MS),
        lastRunAt: now,
      });

      if (await this.fire(schedule)) started += 1;
    }

    return { fired: due.length, started };
  }

  /** @returns Whether a run was started. */
  private async fire(schedule: ScheduleDto): Promise<boolean> {
    const logger = this.logger.child({
      source: RunSchedulesUseCase.name,
      scheduleId: schedule.id,
    });

    // Every title this firing has already been refused. Carried between rounds
    // so the next ask cannot propose them again.
    const refused: string[] = [];

    // Shuffled per firing, so two schedules running at the same cadence do not
    // walk the same areas in the same order and keep colliding with each other.
    const areas = shuffle(ANGLES);

    for (let round = 1; round <= ROUNDS_PER_FIRING; round += 1) {
      const angle = areas[round - 1] ?? FALLBACK_ANGLE;
      const started = await this.tryRound(schedule, refused, round, angle, logger);
      if (started !== null) return started;
    }

    await this.record(
      schedule,
      `Searched ${String(ROUNDS_PER_FIRING)} areas of knowledge; every subject suggested is already covered.`,
    );
    logger.warn('Schedule fired but found nothing new', {
      areas: ROUNDS_PER_FIRING,
      tried: refused.length,
    });
    return false;
  }

  /**
   * One ask, and an attempt at each idea it returned.
   *
   * @returns Whether a run was started, or null when every idea was a duplicate
   *          and another round is worth trying.
   */
  private async tryRound(
    schedule: ScheduleDto,
    refused: string[],
    round: number,
    angle: string,
    logger: Logger,
  ): Promise<boolean | null> {
    const ideas = await this.suggestTopicsUseCase.execute({
      correlationId: `schedule-${schedule.id}-${String(round)}`,
      language: schedule.language,
      count: IDEAS_PER_ROUND,
      durationSeconds: DURATION_SECONDS,
      alsoExclude: refused,
      angle,
    });

    if (!ideas.success) {
      await this.record(schedule, `No topics came back: ${ideas.error.message}`);
      logger.warn('Schedule fired but no topics were produced', { errorCode: ideas.error.code });
      return false;
    }

    for (const idea of ideas.data) {
      const result = await this.generateContentUseCase.execute({
        category: 'general knowledge',
        language: schedule.language,
        audience: 'children and young people',
        durationSeconds: DURATION_SECONDS,
        visualStyle: 'cinematic',
        aspectRatio: '9:16',
        requestedTitle: idea.title,
      });

      if (result.success) {
        await this.scheduleRepository.update(schedule.id, {
          runsStarted: schedule.runsStarted + 1,
          lastError: null,
        });
        logger.info('Schedule started a run', { title: idea.title });
        return true;
      }

      // Only a duplicate is worth another idea. Anything else — the router
      // refusing, the renderer failing — happened *after* a run was created,
      // and that run is sitting there resumable. Trying the next idea then
      // burns the remaining suggestions on the same outage and leaves five
      // broken runs where one would have done.
      if (!this.isDuplicate(result.error.code)) {
        await this.scheduleRepository.update(schedule.id, {
          runsStarted: schedule.runsStarted + 1,
          lastError: `Run stopped: ${result.error.message}`,
        });
        logger.warn('Schedule started a run that failed', {
          title: idea.title,
          errorCode: result.error.code,
        });
        return true;
      }

      refused.push(idea.title);
      logger.debug('Idea already covered, trying the next', { title: idea.title, round, angle });
    }

    // Nothing new this time. The caller asks again with these excluded.
    return null;
  }

  /**
   * Whether the pipeline refused the subject rather than failing at it.
   *
   * `TOPIC_NOT_UNIQUE` is raised before anything is built, so nothing was lost
   * and the next idea costs one more attempt. Every other code means work was
   * started and stopped somewhere later.
   */
  private isDuplicate(code: ErrorCode): boolean {
    return code === ErrorCode.TopicNotUnique;
  }

  private async record(schedule: ScheduleDto, message: string): Promise<void> {
    await this.scheduleRepository.update(schedule.id, { lastError: message });
  }
}

/** Fisher–Yates. A fresh order per firing, so firings do not walk in lockstep. */
function shuffle(values: readonly string[]): string[] {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const here = copy[index];
    const there = copy[swap];

    if (here !== undefined && there !== undefined) {
      copy[index] = there;
      copy[swap] = here;
    }
  }

  return copy;
}
