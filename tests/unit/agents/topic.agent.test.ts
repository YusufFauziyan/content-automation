import { describe, expect, it } from 'vitest';

import { TopicAgent, normalizeTitle } from '../../../src/agents/topic.agent.js';
import type { ContentConfig } from '../../../src/config/app.config.js';
import type { NewTopicDto, TopicDto, TopicRequestDto } from '../../../src/dto/topic.dto.js';
import type { EmbeddingRepository } from '../../../src/repositories/embedding.repository.js';
import type { TopicRepository } from '../../../src/repositories/topic.repository.js';
import type { NineRouterService } from '../../../src/services/nine-router.service.js';
import type { EmbeddingService } from '../../../src/services/embedding.service.js';
import type { PromptLoader } from '../../../src/services/prompt-loader.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { TopicStatus } from '../../../src/types/topic.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const config: ContentConfig = {
  topicMaxAttempts: 3,
  topicSimilarityThreshold: 0.9,
  scriptTargetDurationSeconds: 45,
};

const request: TopicRequestDto = {
  correlationId: 'run-1',
  category: 'personal finance',
  language: 'en',
  audience: 'first-time investors',
  durationSeconds: 45,
};

const promptLoader: PromptLoader = { render: () => Promise.resolve('rendered prompt') };

/** Answers with each payload in turn, repeating the last one. */
const aiReturning = (...payloads: readonly unknown[]): NineRouterService => {
  let index = 0;

  return {
    complete: () => Promise.reject(new Error('not used')),
    generateImage: () => Promise.reject(new Error('not used')),
    completeJson: () => {
      const payload = payloads[Math.min(index, payloads.length - 1)];
      index += 1;

      return Promise.resolve(payload);
    },
  };
};

const storedTopic = (title: string): TopicDto => ({
  id: 'topic-1',
  title,
  normalizedTitle: normalizeTitle(title),
  description: null,
  language: 'en',
  category: 'personal finance',
  audience: 'first-time investors',
  status: TopicStatus.Accepted,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

/** Repository whose exact-title lookup knows about `existingTitles`. */
const topicRepositoryWith = (
  existingTitles: readonly string[],
  created: NewTopicDto[],
): TopicRepository =>
  asFake<TopicRepository>({
    findRecentTitles: () => Promise.resolve(existingTitles),
    findByNormalizedTitle: (normalized) =>
      Promise.resolve(
        existingTitles.some((title) => normalizeTitle(title) === normalized)
          ? storedTopic(normalized)
          : null,
      ),
    create: (input) => {
      created.push(input);
      return Promise.resolve(storedTopic(input.title));
    },
  });

const noEmbeddings = asFake<EmbeddingRepository>({});

describe('TopicAgent', () => {
  it('stores an accepted topic when the title is new', async () => {
    const created: NewTopicDto[] = [];
    const agent = new TopicAgent(
      aiReturning({ title: 'Why index funds beat stock picking', description: 'Because fees.' }),
      promptLoader,
      topicRepositoryWith([], created),
      noEmbeddings,
      null,
      config,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.status).toBe(TopicStatus.Accepted);
    expect(created[0]?.normalizedTitle).toBe('why index funds beat stock picking');
  });

  it('rejects an exact duplicate and accepts the next candidate', async () => {
    const created: NewTopicDto[] = [];
    const agent = new TopicAgent(
      aiReturning(
        { title: 'Already covered', description: null },
        { title: 'Something new', description: null },
      ),
      promptLoader,
      topicRepositoryWith(['Already Covered'], created),
      noEmbeddings,
      null,
      config,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.title).toBe('Something new');
  });

  it('gives up after the configured number of attempts', async () => {
    const created: NewTopicDto[] = [];
    const agent = new TopicAgent(
      aiReturning({ title: 'Already covered', description: null }),
      promptLoader,
      topicRepositoryWith(['Already covered'], created),
      noEmbeddings,
      null,
      config,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.TopicNotUnique);
    expect(created).toHaveLength(0);
  });

  it('rejects a semantic duplicate when embeddings are available', async () => {
    const created: NewTopicDto[] = [];
    const embeddingService: EmbeddingService = {
      embed: () => Promise.resolve({ model: 'test', dimensions: 3, values: [0.1, 0.2, 0.3] }),
    };
    const embeddingRepository = asFake<EmbeddingRepository>({
      findSimilar: () =>
        Promise.resolve([
          { topicId: 'topic-9', title: 'A near-identical topic', similarity: 0.97 },
        ]),
    });

    const agent = new TopicAgent(
      aiReturning({ title: 'A nearly identical topic', description: null }),
      promptLoader,
      topicRepositoryWith([], created),
      embeddingRepository,
      embeddingService,
      config,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.TopicNotUnique);
  });

  it('reports an unusable model answer as a retryable failure', async () => {
    const agent = new TopicAgent(
      aiReturning({ headline: 'wrong shape' }),
      promptLoader,
      topicRepositoryWith([], []),
      noEmbeddings,
      null,
      config,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
    expect(result.success ? null : result.error.retryable).toBe(true);
  });
});

describe('normalizeTitle', () => {
  it('ignores casing and stray whitespace', () => {
    expect(normalizeTitle('  The   SAME  Topic ')).toBe('the same topic');
  });
});
