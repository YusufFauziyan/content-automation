import { describe, expect, it } from 'vitest';

import {
  NarrationPlannerAgent,
  countWords,
  estimateDurationSeconds,
} from '../../../src/agents/narration-planner.agent.js';
import type { NarrationConfig } from '../../../src/config/app.config.js';
import type { ContentDto, ContentUpdateDto } from '../../../src/dto/content.dto.js';
import { NarrationEmphasis, type NarrationPlanRequestDto } from '../../../src/dto/narration.dto.js';
import type { ScriptDto } from '../../../src/dto/script.dto.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type { NineRouterService } from '../../../src/services/nine-router.service.js';
import type { PromptLoader } from '../../../src/services/prompt-loader.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const SCRIPT =
  'Artificial intelligence is changing programming forever. ' +
  'Developers who embrace it will work much faster than those who do not.';

const script: ScriptDto = {
  contentId: 'content-1',
  topicId: 'topic-1',
  title: 'AI and programming',
  hook: 'Artificial intelligence is changing programming forever.',
  script: SCRIPT,
  caption: 'A caption',
  hashtags: ['ai'],
  thumbnailPrompt: 'A keyboard',
  language: 'en',
  durationSeconds: 20,
};

const request: NarrationPlanRequestDto = {
  correlationId: 'run-1',
  script,
  durationSeconds: 20,
};

const narrationConfig: NarrationConfig = { wordsPerMinute: 150 };

const promptLoader: PromptLoader = { render: () => Promise.resolve('rendered prompt') };

const aiReturning = (payload: unknown): NineRouterService => ({
  complete: () => Promise.reject(new Error('not used')),
  completeJson: () => Promise.resolve(payload),
  generateImage: () => Promise.reject(new Error('not used')),
});

const contentRepositoryInto = (updates: ContentUpdateDto[]): ContentRepository =>
  asFake<ContentRepository>({
    update: (_id, input) => {
      updates.push(input);
      return Promise.resolve(asFake<ContentDto>({ id: 'content-1' }));
    },
  });

/** Blocks that together reproduce the script. */
const faithfulBlocks = [
  {
    text: 'Artificial intelligence is changing programming forever.',
    pauseAfter: 0.5,
    emphasis: 'strong',
  },
  {
    text: 'Developers who embrace it will work much faster than those who do not.',
    pauseAfter: 0.3,
    emphasis: 'normal',
  },
];

const createAgent = (payload: unknown, updates: ContentUpdateDto[] = []): NarrationPlannerAgent =>
  new NarrationPlannerAgent(
    aiReturning(payload),
    promptLoader,
    contentRepositoryInto(updates),
    narrationConfig,
    1,
    new NoopLogger(),
  );

describe('countWords', () => {
  it('counts runs of non-space', () => {
    expect(countWords('one two  three')).toBe(3);
  });

  it('counts nothing in empty text', () => {
    expect(countWords('   ')).toBe(0);
  });
});

describe('estimateDurationSeconds', () => {
  it('derives seconds from the speaking rate', () => {
    // 150 words at 150 wpm is one minute.
    expect(estimateDurationSeconds('word '.repeat(150), 150, 1)).toBe(60);
  });

  it('shortens the estimate when the voice is sped up', () => {
    expect(estimateDurationSeconds('word '.repeat(150), 150, 2)).toBe(30);
  });

  it('never returns zero, so a cue is always visible', () => {
    expect(estimateDurationSeconds('hi', 150, 1)).toBeGreaterThan(0);
  });
});

describe('NarrationPlannerAgent', () => {
  it('numbers the blocks and persists the plan', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = createAgent({ blocks: faithfulBlocks }, updates);

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(result.success ? result.data.blocks.map((b) => b.id) : []).toEqual([1, 2]);
    expect(updates[0]?.narrationBlocks).toHaveLength(2);
  });

  it('times each block from the speaking rate rather than trusting the model', async () => {
    const agent = createAgent({
      blocks: [{ ...faithfulBlocks[0]!, estimatedDuration: 999 }, faithfulBlocks[1]!],
    });

    const result = await agent.execute(request);
    const first = result.success ? result.data.blocks[0] : undefined;

    // Six words at 150 wpm is 2.4 seconds; the model's 999 is ignored.
    expect(first?.estimatedDuration).toBeCloseTo(2.4, 1);
  });

  it('maps emphasis onto the domain enum', async () => {
    const agent = createAgent({ blocks: faithfulBlocks });

    const result = await agent.execute(request);

    expect(result.success ? result.data.blocks[0]?.emphasis : null).toBe(NarrationEmphasis.Strong);
  });

  it('drops the pause after the final block, so the video does not end in silence', async () => {
    const agent = createAgent({ blocks: faithfulBlocks });

    const result = await agent.execute(request);
    const blocks = result.success ? result.data.blocks : [];

    expect(blocks[blocks.length - 1]?.pauseAfter).toBe(0);
  });

  it('reports the total of speech and pauses', async () => {
    const agent = createAgent({ blocks: faithfulBlocks });

    const result = await agent.execute(request);
    const plan = result.success ? result.data : null;
    const expected = (plan?.blocks ?? []).reduce(
      (total, block) => total + block.estimatedDuration + block.pauseAfter,
      0,
    );

    expect(plan?.totalDurationSeconds).toBeCloseTo(expected, 1);
  });

  it('rejects blocks that paraphrase instead of quoting the script', async () => {
    const agent = createAgent({
      blocks: [{ text: 'AI changes coding.', pauseAfter: 0.3, emphasis: 'normal' }],
    });

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('rejects blocks that drop half the script', async () => {
    const agent = createAgent({ blocks: [faithfulBlocks[0]!] });

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
  });

  it('rejects an unusable payload', async () => {
    const agent = createAgent({ blocks: [] });

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('persists nothing when the plan is rejected', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = createAgent({ blocks: [] }, updates);

    await agent.execute(request);

    expect(updates).toHaveLength(0);
  });
});
