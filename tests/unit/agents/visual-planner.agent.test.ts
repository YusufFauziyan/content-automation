import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VisualPlannerAgent } from '../../../src/agents/visual-planner.agent.js';
import type { ImageConfig, MediaConfig } from '../../../src/config/app.config.js';
import type { ContentDto, ContentUpdateDto } from '../../../src/dto/content.dto.js';
import { SceneCamera, SceneTransition, type SceneDto } from '../../../src/dto/scene.dto.js';
import type { VisualPlanRequestDto } from '../../../src/dto/visual-prompt.dto.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type { NineRouterService } from '../../../src/services/nine-router.service.js';
import {
  FilePromptLoader,
  type PromptLoader,
} from '../../../src/services/prompt-loader.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const imageConfig: ImageConfig = {
  width: 1024,
  height: 1792,
  aspectRatio: '4:7',
  quality: 'high detail, sharp focus, 8k',
};

const mediaConfig: MediaConfig = {
  outputDirectory: resolve('output'),
  promptsDirectory: resolve('src/prompts'),
};

const scene = (number: number): SceneDto => ({
  scene: number,
  duration: 5,
  narration: `Narration ${String(number)}`,
  imagePrompt: `A draft idea for scene ${String(number)}`,
  camera: SceneCamera.ZoomIn,
  transition: SceneTransition.Fade,
  style: 'cinematic',
});

const request: VisualPlanRequestDto = {
  correlationId: 'run-1',
  scenePlan: {
    contentId: 'content-1',
    scenes: [scene(1), scene(2)],
    totalDurationSeconds: 10,
  },
  visualStyle: 'cinematic',
  aspectRatio: '4:7',
};

const brief = (number: number): Record<string, unknown> => ({
  scene: number,
  subject: `A lighthouse keeper number ${String(number)}`,
  environment: 'A rocky shore at dusk',
  lighting: 'Low warm side light',
  cameraAngle: 'Low angle',
  lens: '35mm, shallow depth of field',
  composition: 'Subject on the left third, centre kept clear',
  visualStyle: 'cinematic',
  colorPalette: 'slate blue, amber, sea green',
  quality: 'high detail, sharp focus, 8k',
  aspectRatio: '4:7',
  consistency: 'Same keeper, same coat, same palette across every scene',
  negative: 'on-screen text, watermarks, logos',
});

const aiReturning = (payload: unknown): NineRouterService => ({
  complete: () => Promise.reject(new Error('not used')),
  completeJson: () => Promise.resolve(payload),
  generateImage: () => Promise.reject(new Error('not used')),
});

/** Uses the real templates: the assembled prompt is part of the contract. */
const promptLoader: PromptLoader = new FilePromptLoader(mediaConfig);

const contentRepositoryInto = (updates: ContentUpdateDto[]): ContentRepository =>
  asFake<ContentRepository>({
    update: (_id, input) => {
      updates.push(input);
      return Promise.resolve(asFake<ContentDto>({ id: 'content-1' }));
    },
  });

const createAgent = (payload: unknown, updates: ContentUpdateDto[] = []): VisualPlannerAgent =>
  new VisualPlannerAgent(
    aiReturning(payload),
    promptLoader,
    contentRepositoryInto(updates),
    imageConfig,
    new NoopLogger(),
  );

describe('VisualPlannerAgent', () => {
  it('produces one brief per scene and persists them', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = createAgent({ prompts: [brief(1), brief(2)] }, updates);

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(result.success ? result.data.prompts : []).toHaveLength(2);
    expect(updates[0]?.visualPrompts).toHaveLength(2);
  });

  it('assembles a prompt that names every axis of the brief', async () => {
    const agent = createAgent({ prompts: [brief(1), brief(2)] });

    const result = await agent.execute(request);
    const prompt = result.success ? (result.data.prompts[0]?.prompt ?? '') : '';

    expect(prompt).toContain('A lighthouse keeper number 1');
    expect(prompt).toContain('A rocky shore at dusk');
    expect(prompt).toContain('Low warm side light');
    expect(prompt).toContain('Low angle');
    expect(prompt).toContain('35mm, shallow depth of field');
    expect(prompt).toContain('slate blue, amber, sea green');
    expect(prompt).toContain('4:7');
    expect(prompt).toContain('Same keeper, same coat');
  });

  it('always forbids on-screen text, whatever the brief said', async () => {
    const agent = createAgent({ prompts: [brief(1), brief(2)] });

    const result = await agent.execute(request);
    const prompt = result.success ? (result.data.prompts[0]?.prompt ?? '') : '';

    expect(prompt).toContain('watermarks');
    expect(prompt).toContain('captions');
  });

  it('leaves no placeholder unresolved in the assembled prompt', async () => {
    const agent = createAgent({ prompts: [brief(1), brief(2)] });

    const result = await agent.execute(request);
    const prompt = result.success ? (result.data.prompts[0]?.prompt ?? '') : '';

    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('Consumed by');
  });

  it('rejects a plan that does not cover every scene', async () => {
    const agent = createAgent({ prompts: [brief(1)] });

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('rejects briefs whose scene numbers do not match the plan', async () => {
    const agent = createAgent({ prompts: [brief(1), brief(3)] });

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('rejects a brief with a missing axis', async () => {
    const { lighting: _lighting, ...incomplete } = brief(1);
    const agent = createAgent({ prompts: [incomplete, brief(2)] });

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('persists nothing when the plan is unusable', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = createAgent({ prompts: [] }, updates);

    await agent.execute(request);

    expect(updates).toHaveLength(0);
  });
});
