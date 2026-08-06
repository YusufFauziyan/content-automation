import { describe, expect, it } from 'vitest';

import { ScriptAgent } from '../../../src/agents/script.agent.js';
import type { ContentDto, NewContentDto } from '../../../src/dto/content.dto.js';
import type { ScriptRequestDto } from '../../../src/dto/script.dto.js';
import type { TopicDto } from '../../../src/dto/topic.dto.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type { NineRouterService } from '../../../src/services/nine-router.service.js';
import type { PromptLoader } from '../../../src/services/prompt-loader.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { TopicStatus } from '../../../src/types/topic.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const topic: TopicDto = {
  id: 'topic-1',
  title: 'Why index funds beat stock picking',
  normalizedTitle: 'why index funds beat stock picking',
  description: 'Fees compound too.',
  language: 'en',
  category: 'personal finance',
  audience: 'first-time investors',
  status: TopicStatus.Accepted,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const request: ScriptRequestDto = {
  correlationId: 'run-1',
  topic,
  durationSeconds: 45,
  audience: 'first-time investors',
};

const promptLoader: PromptLoader = { render: () => Promise.resolve('rendered prompt') };

const aiReturning = (payload: unknown): NineRouterService => ({
  complete: () => Promise.reject(new Error('not used')),
  completeJson: () => Promise.resolve(payload),
  generateImage: () => Promise.reject(new Error('not used')),
});

const validDraft = {
  title: 'Why index funds win',
  hook: 'You are probably losing money right now.',
  script: 'You are probably losing money right now. Here is why index funds win over time.',
  caption: 'The math nobody shows you.',
  hashtags: ['#investing', 'finance', '#money'],
  thumbnailPrompt: 'A rising chart on a dark background',
};

const contentRepositoryInto = (created: NewContentDto[]): ContentRepository =>
  asFake<ContentRepository>({
    create: (input) => {
      created.push(input);

      return Promise.resolve(
        asFake<ContentDto>({
          id: 'content-1',
          topicId: input.topicId,
          language: input.language,
        }),
      );
    },
  });

describe('ScriptAgent', () => {
  it('persists the script and returns its content id', async () => {
    const created: NewContentDto[] = [];
    const agent = new ScriptAgent(
      aiReturning(validDraft),
      promptLoader,
      contentRepositoryInto(created),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(result.success ? result.data.contentId : null).toBe('content-1');
    expect(created[0]?.hook).toBe(validDraft.hook);
    expect(created[0]?.targetDurationSeconds).toBe(45);
  });

  it('stores hashtags without their leading hash', async () => {
    const created: NewContentDto[] = [];
    const agent = new ScriptAgent(
      aiReturning(validDraft),
      promptLoader,
      contentRepositoryInto(created),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(created[0]?.hashtags).toEqual(['investing', 'finance', 'money']);
  });

  it('rejects a draft with too few hashtags', async () => {
    const agent = new ScriptAgent(
      aiReturning({ ...validDraft, hashtags: ['only-one'] }),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('rejects a draft that is missing the hook', async () => {
    const { hook: _hook, ...withoutHook } = validDraft;
    const agent = new ScriptAgent(
      aiReturning(withoutHook),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('does not persist anything when the draft is unusable', async () => {
    const created: NewContentDto[] = [];
    const agent = new ScriptAgent(
      aiReturning({}),
      promptLoader,
      contentRepositoryInto(created),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(created).toHaveLength(0);
  });
});
