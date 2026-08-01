import { describe, expect, it } from 'vitest';

import { SceneAgent } from '../../../src/agents/scene.agent.js';
import type { ContentDto, ContentUpdateDto } from '../../../src/dto/content.dto.js';
import {
  SceneCamera,
  SceneTransition,
  type ScenePlanRequestDto,
} from '../../../src/dto/scene.dto.js';
import type { ScriptDto } from '../../../src/dto/script.dto.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type { NineRouterService } from '../../../src/services/nine-router.service.js';
import type { PromptLoader } from '../../../src/services/prompt-loader.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const script: ScriptDto = {
  contentId: 'content-1',
  topicId: 'topic-1',
  title: 'Why index funds win',
  hook: 'You are probably losing money.',
  script: 'You are probably losing money. Fees compound just like returns do.',
  caption: 'The math nobody shows you.',
  hashtags: ['investing'],
  thumbnailPrompt: 'A rising chart',
  language: 'en',
  durationSeconds: 10,
};

const request: ScenePlanRequestDto = {
  correlationId: 'run-1',
  script,
  durationSeconds: 10,
  visualStyle: 'cinematic',
};

const promptLoader: PromptLoader = { render: () => Promise.resolve('rendered prompt') };

const aiReturning = (payload: unknown): NineRouterService => ({
  complete: () => Promise.reject(new Error('not used')),
  completeJson: () => Promise.resolve(payload),
  generateImage: () => Promise.reject(new Error('not used')),
});

const scene = (index: number, duration: number, camera = 'zoom in'): Record<string, unknown> => ({
  scene: index,
  duration,
  narration: `Narration ${String(index)}`,
  imagePrompt: `Image ${String(index)}`,
  camera,
  transition: 'fade',
  style: 'cinematic',
});

const contentRepositoryInto = (updates: ContentUpdateDto[]): ContentRepository =>
  asFake<ContentRepository>({
    update: (_id, input) => {
      updates.push(input);
      return Promise.resolve(asFake<ContentDto>({ id: 'content-1' }));
    },
  });

describe('SceneAgent', () => {
  it('persists the scene plan and reports its total duration', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = new SceneAgent(
      aiReturning({ scenes: [scene(1, 4), scene(2, 6)] }),
      promptLoader,
      contentRepositoryInto(updates),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(result.success ? result.data.totalDurationSeconds : null).toBe(10);
    expect(updates[0]?.scenes).toHaveLength(2);
  });

  it('maps camera and transition onto the domain enums', async () => {
    const agent = new SceneAgent(
      aiReturning({ scenes: [scene(1, 10, 'Zoom In')] }),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success ? result.data.scenes[0]?.camera : null).toBe(SceneCamera.ZoomIn);
    expect(result.success ? result.data.scenes[0]?.transition : null).toBe(SceneTransition.Fade);
  });

  it('rejects a plan whose scene numbers are not contiguous', async () => {
    const agent = new SceneAgent(
      aiReturning({ scenes: [scene(1, 5), scene(3, 5)] }),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('rejects a plan whose durations do not add up to the target', async () => {
    const agent = new SceneAgent(
      aiReturning({ scenes: [scene(1, 30), scene(2, 30)] }),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('tolerates small duration drift', async () => {
    const agent = new SceneAgent(
      aiReturning({ scenes: [scene(1, 5), scene(2, 6)] }),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
  });

  it('rejects an unknown camera movement', async () => {
    const agent = new SceneAgent(
      aiReturning({ scenes: [scene(1, 10, 'barrel roll')] }),
      promptLoader,
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
  });

  it('does not persist anything when the plan is unusable', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = new SceneAgent(
      aiReturning({ scenes: [] }),
      promptLoader,
      contentRepositoryInto(updates),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(updates).toHaveLength(0);
  });
});
