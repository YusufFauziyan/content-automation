import { describe, expect, it } from 'vitest';

import type { ScheduleDto, ScheduleUpdateDto } from '../../../src/dto/schedule.dto.js';
import type { ScheduleRepository } from '../../../src/repositories/schedule.repository.js';
import type { ApplicationError } from '../../../src/types/errors/application.error.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { fail, ok } from '../../../src/types/result.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { RunSchedulesUseCase } from '../../../src/use-cases/run-schedules.usecase.js';
import { asFake } from '../../support/fakes.js';

const schedule: ScheduleDto = {
  id: 'schedule-1',
  name: 'Nightly',
  language: 'en',
  intervalMinutes: 360,
  enabled: true,
  nextRunAt: new Date(0),
  lastRunAt: null,
  runsStarted: 0,
  lastError: null,
  createdAt: new Date(0),
};

const repositoryInto = (updates: ScheduleUpdateDto[]): ScheduleRepository =>
  asFake<ScheduleRepository>({
    findDue: () => Promise.resolve([schedule]),
    update: (_id, input) => {
      updates.push(input);
      return Promise.resolve(schedule);
    },
  });

/** Answers each round from a queue, and records what it was asked to avoid. */
const ideasReturning = (
  rounds: readonly (readonly string[])[],
  excluded: string[][] = [],
  angles: string[] = [],
) => {
  let call = 0;

  return asFake<{
    execute: (input: {
      alsoExclude?: readonly string[];
      angle?: string;
    }) => Promise<ReturnType<typeof ok>>;
  }>({
    execute: (input) => {
      excluded.push([...(input.alsoExclude ?? [])]);
      if (input.angle !== undefined) angles.push(input.angle);
      const titles = rounds[call] ?? rounds[rounds.length - 1] ?? [];
      call += 1;

      return Promise.resolve(ok(titles.map((title) => ({ title, hook: 'h', why: 'w' }))));
    },
  }) as never;
};

/** A pipeline that answers each call from a queue of outcomes. */
const pipelineReturning = (outcomes: readonly ('ok' | ErrorCode)[], seen: string[]) => {
  let call = 0;

  return asFake<{ execute: (input: { requestedTitle?: string }) => Promise<unknown> }>({
    execute: (input) => {
      seen.push(input.requestedTitle ?? '');
      // The last outcome repeats, so "always refused" needs one entry rather
      // than one per call — and cannot silently succeed when the queue runs dry.
      const outcome = outcomes[call] ?? outcomes[outcomes.length - 1] ?? 'ok';
      call += 1;

      return Promise.resolve(
        outcome === 'ok'
          ? ok({})
          : fail(
              asFake<ApplicationError>({
                code: outcome,
                message: 'stopped',
                retryable: false,
              }),
            ),
      );
    },
  }) as never;
};

describe('RunSchedulesUseCase', () => {
  it('tries the next idea when a subject is already covered', async () => {
    // The duplicate rule refusing a title costs nothing — nothing was built.
    const seen: string[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto([]),
      ideasReturning([['one', 'two', 'three']]),
      pipelineReturning([ErrorCode.TopicNotUnique, ErrorCode.TopicNotUnique, 'ok'], seen),
      new NoopLogger(),
    );

    const result = await useCase.tick(new Date());

    expect(seen).toEqual(['one', 'two', 'three']);
    expect(result.started).toBe(1);
  });

  it('stops at the first failure that is not a duplicate', async () => {
    // The run exists and is resumable. Trying four more ideas against the same
    // outage leaves five broken runs where one would have done — which is
    // exactly what a router outage produced before this rule.
    const seen: string[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto([]),
      ideasReturning([['one', 'two', 'three', 'four', 'five']]),
      pipelineReturning([ErrorCode.AiRetriesExhausted], seen),
      new NoopLogger(),
    );

    await useCase.tick(new Date());

    expect(seen).toEqual(['one']);
  });

  it('records why it stopped, not a guess', async () => {
    const updates: ScheduleUpdateDto[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto(updates),
      ideasReturning([['one']]),
      pipelineReturning([ErrorCode.AiRetriesExhausted], []),
      new NoopLogger(),
    );

    await useCase.tick(new Date());

    expect(updates.some((update) => update.lastError?.includes('Run stopped'))).toBe(true);
    expect(updates.some((update) => update.lastError?.includes('already covered'))).toBe(false);
  });

  it('advances the next firing before attempting, so a failure cannot spin', async () => {
    const updates: ScheduleUpdateDto[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto(updates),
      ideasReturning([['one']]),
      pipelineReturning([ErrorCode.AiRetriesExhausted], []),
      new NoopLogger(),
    );

    await useCase.tick(new Date());

    expect(updates[0]?.nextRunAt).toBeInstanceOf(Date);
  });
});

describe('RunSchedulesUseCase when a whole batch is already covered', () => {
  it('asks again instead of giving up', async () => {
    // One batch and give up meant a schedule could go hours producing nothing,
    // because a model asked twice returns much the same crowd-pleasers.
    const seen: string[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto([]),
      ideasReturning([
        ['taken-1', 'taken-2'],
        ['fresh-1'],
      ]),
      pipelineReturning(
        [ErrorCode.TopicNotUnique, ErrorCode.TopicNotUnique, 'ok'],
        seen,
      ),
      new NoopLogger(),
    );

    const result = await useCase.tick(new Date());

    expect(seen).toEqual(['taken-1', 'taken-2', 'fresh-1']);
    expect(result.started).toBe(1);
  });

  it('tells the model which titles it just refused', async () => {
    // Without this the second ask proposes the same subjects again — the model
    // has no memory between calls.
    const excluded: string[][] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto([]),
      ideasReturning([['taken-1', 'taken-2'], ['fresh-1']], excluded),
      pipelineReturning([ErrorCode.TopicNotUnique, ErrorCode.TopicNotUnique, 'ok'], []),
      new NoopLogger(),
    );

    await useCase.tick(new Date());

    expect(excluded[0]).toEqual([]);
    expect(excluded[1]).toEqual(['taken-1', 'taken-2']);
  });

  it('searches every area before accepting there is nothing new', async () => {
    const updates: ScheduleUpdateDto[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto(updates),
      // Every area returns the same already-taken subject.
      ideasReturning([['always-taken']]),
      pipelineReturning([ErrorCode.TopicNotUnique], []),
      new NoopLogger(),
    );

    const result = await useCase.tick(new Date());

    expect(result.started).toBe(0);
    expect(
      updates.some((update) => update.lastError?.includes('areas of knowledge')),
    ).toBe(true);
  });
});

describe('RunSchedulesUseCase searching for something new', () => {
  it('asks about a different area each round', async () => {
    // Asked without an area a model returns the same favourites however often
    // it is asked, so repeating the question is not what finds a fresh subject
    // — searching somewhere else is.
    const angles: string[] = [];
    const useCase = new RunSchedulesUseCase(
      repositoryInto([]),
      ideasReturning([['taken']], [], angles),
      pipelineReturning([ErrorCode.TopicNotUnique], []),
      new NoopLogger(),
    );

    await useCase.tick(new Date());

    expect(angles.length).toBeGreaterThan(4);
    expect(new Set(angles).size).toBe(angles.length);
  });
});
