import { describe, expect, it } from 'vitest';

import { ImageAgent, toImageFileName } from '../../../src/agents/image.agent.js';
import type { ImageConfig } from '../../../src/config/app.config.js';
import type { ImageGenerationRequestDto } from '../../../src/dto/image.dto.js';
import type { VisualPromptDto } from '../../../src/dto/visual-prompt.dto.js';
import type {
  ImageRepository,
  NewSceneImageDto,
  SceneImageDto,
} from '../../../src/repositories/image.repository.js';
import type { HuggingFaceImageService } from '../../../src/services/huggingface-image.service.js';
import type {
  AiImageRequest,
  NineRouterService,
} from '../../../src/services/nine-router.service.js';
import {
  WorkspaceFolder,
  type StoredFileDto,
  type WorkingDirectoryService,
  type WorkspaceDto,
} from '../../../src/services/working-directory.service.js';
import { AiRouterError } from '../../../src/types/errors/ai-router.error.js';
import { ImageProviderError } from '../../../src/types/errors/image-provider.error.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const imageConfig: ImageConfig = {
  width: 1024,
  height: 1792,
  aspectRatio: '4:7',
  quality: 'high detail',
};

const prompt = (scene: number): VisualPromptDto =>
  asFake<VisualPromptDto>({ scene, prompt: `assembled prompt for scene ${String(scene)}` });

/** A PNG header with real dimensions — enough for the agent to read them back. */
const pngBytes = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);

  return bytes;
};

const request: ImageGenerationRequestDto = {
  correlationId: 'run-1',
  workflowId: 'workflow-1',
  contentId: 'content-1',
  prompts: [prompt(1), prompt(2)],
};

const workspace: WorkspaceDto = {
  workflowId: 'workflow-1',
  root: '/tmp/out/workflows/workflow-1',
  folders: {
    [WorkspaceFolder.Images]: '/tmp/out/workflows/workflow-1/images',
    [WorkspaceFolder.Audio]: '/tmp/out/workflows/workflow-1/audio',
    [WorkspaceFolder.Subtitle]: '/tmp/out/workflows/workflow-1/subtitle',
    [WorkspaceFolder.Video]: '/tmp/out/workflows/workflow-1/video',
    [WorkspaceFolder.Thumbnail]: '/tmp/out/workflows/workflow-1/thumbnail',
  },
};

/** Records what was written so the file names and folder can be asserted. */
const recordingWorkspace = (
  written: { folder: WorkspaceFolder; fileName: string; byteSize: number }[],
): WorkingDirectoryService => ({
  prepare: () => Promise.resolve(workspace),
  write: (_workspace, folder, fileName, data) => {
    written.push({ folder, fileName, byteSize: data.byteLength });

    return Promise.resolve<StoredFileDto>({
      fileName,
      relativePath: `${folder}/${fileName}`,
      absolutePath: `${workspace.root}/${folder}/${fileName}`,
      byteSize: data.byteLength,
    });
  },
  resolve: (_workspace, folder, fileName) => `${workspace.root}/${folder}/${fileName}`,
  describe: (_workspace, folder, fileName) =>
    Promise.resolve<StoredFileDto>({
      fileName,
      relativePath: `${folder}/${fileName}`,
      absolutePath: `${workspace.root}/${folder}/${fileName}`,
      byteSize: 1024,
    }),
  remove: () => Promise.resolve(),
});

const routerReturning = (requests: AiImageRequest[], failOnScene?: number): NineRouterService => {
  let call = 0;

  return {
    complete: () => Promise.reject(new Error('not used')),
    completeJson: () => Promise.reject(new Error('not used')),
    generateImage: (imageRequest) => {
      call += 1;
      requests.push(imageRequest);

      if (call === failOnScene) {
        return Promise.reject(new AiRouterError('router refused', false));
      }

      return Promise.resolve({
        data: pngBytes(1024, 1792),
        mimeType: 'image/png',
        combo: 'image-combo',
      });
    },
  };
};

/** A fallback provider that answers with a distinguishable image. */
const fallbackReturning = (
  requests: AiImageRequest[],
  failing = false,
): HuggingFaceImageService => ({
  generateImage: (imageRequest) => {
    requests.push(imageRequest);

    if (failing) {
      return Promise.reject(new ImageProviderError('provider refused', false));
    }

    return Promise.resolve({
      data: pngBytes(1024, 1792),
      mimeType: 'image/png',
      combo: 'fallback-model',
    });
  },
});

const repositoryInto = (saved: NewSceneImageDto[]): ImageRepository =>
  asFake<ImageRepository>({
    save: (input) => {
      saved.push(input);
      return Promise.resolve(asFake<SceneImageDto>({ id: 'image-1' }));
    },
  });

describe('toImageFileName', () => {
  it('pads the scene number to three digits', () => {
    expect(toImageFileName(1, 'png')).toBe('scene-001.png');
    expect(toImageFileName(2, 'png')).toBe('scene-002.png');
    expect(toImageFileName(12, 'png')).toBe('scene-012.png');
    expect(toImageFileName(123, 'png')).toBe('scene-123.png');
  });

  it('keeps files in scene order when sorted as text', () => {
    const names = [10, 2, 1].map((scene) => toImageFileName(scene, 'png')).sort();

    expect(names).toEqual(['scene-001.png', 'scene-002.png', 'scene-010.png']);
  });

  it('names the file after the format that actually arrived', () => {
    expect(toImageFileName(1, 'jpg')).toBe('scene-001.jpg');
  });
});

describe('ImageAgent', () => {
  it('generates one image per scene', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; byteSize: number }[] = [];
    const agent = new ImageAgent(
      routerReturning([]),
      null,
      recordingWorkspace(written),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(result.success ? result.data.images : []).toHaveLength(2);
    expect(written.map((entry) => entry.fileName)).toEqual(['scene-001.png', 'scene-002.png']);
  });

  it('writes into the images folder of the run workspace', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; byteSize: number }[] = [];
    const agent = new ImageAgent(
      routerReturning([]),
      null,
      recordingWorkspace(written),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(written.every((entry) => entry.folder === WorkspaceFolder.Images)).toBe(true);
    expect(result.success ? result.data.imagesDirectory : null).toBe(
      workspace.folders[WorkspaceFolder.Images],
    );
  });

  it('sends the assembled prompt verbatim and never rebuilds it', async () => {
    const requests: AiImageRequest[] = [];
    const agent = new ImageAgent(
      routerReturning(requests),
      null,
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(requests.map((entry) => entry.prompt)).toEqual([
      'assembled prompt for scene 1',
      'assembled prompt for scene 2',
    ]);
    expect(requests[0]?.width).toBe(1024);
    expect(requests[0]?.height).toBe(1792);
  });

  it('records metadata for every image, and never the bytes', async () => {
    const saved: NewSceneImageDto[] = [];
    const agent = new ImageAgent(
      routerReturning([]),
      null,
      recordingWorkspace([]),
      repositoryInto(saved),
      imageConfig,
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      contentId: 'content-1',
      workflowRunId: 'workflow-1',
      sceneNumber: 1,
      fileName: 'scene-001.png',
      relativePath: 'images/scene-001.png',
      width: 1024,
      height: 1792,
      combo: 'image-combo',
    });
    expect(JSON.stringify(saved[0])).not.toContain('data');
  });

  it('reports the generation duration of each image', async () => {
    const agent = new ImageAgent(
      routerReturning([]),
      null,
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);
    const first = result.success ? result.data.images[0] : undefined;

    expect(first?.generationDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.success ? result.data.totalDurationMs : -1).toBeGreaterThanOrEqual(0);
  });

  it('returns a typed failure when the router refuses a scene', async () => {
    const agent = new ImageAgent(
      routerReturning([], 2),
      null,
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AiRequestFailed);
  });

  it('stops at the failing scene rather than continuing without it', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; byteSize: number }[] = [];
    const agent = new ImageAgent(
      routerReturning([], 1),
      null,
      recordingWorkspace(written),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(written).toHaveLength(0);
  });
});

describe('ImageAgent fallback', () => {
  it('falls back to the other provider when the router refuses', async () => {
    // The router has already spent its own retry budget by the time it reports
    // a failure, so a second opinion costs one call and can save a run that
    // already paid for a topic, a script and a scene plan.
    const fallbackRequests: AiImageRequest[] = [];
    const agent = new ImageAgent(
      routerReturning([], 1),
      fallbackReturning(fallbackRequests),
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(fallbackRequests).toHaveLength(1);
  });

  it('sends the fallback the same brief, unedited', async () => {
    const fallbackRequests: AiImageRequest[] = [];
    const agent = new ImageAgent(
      routerReturning([], 1),
      fallbackReturning(fallbackRequests),
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(fallbackRequests[0]).toEqual({
      prompt: 'assembled prompt for scene 1',
      width: imageConfig.width,
      height: imageConfig.height,
    });
  });

  it('records which provider actually produced the image', async () => {
    // Provenance is the point: a run half-served by each provider has to be
    // readable from the stored metadata alone.
    const saved: NewSceneImageDto[] = [];
    const agent = new ImageAgent(
      routerReturning([], 1),
      fallbackReturning([]),
      recordingWorkspace([]),
      repositoryInto(saved),
      imageConfig,
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(saved.map((entry) => entry.combo)).toEqual(['fallback-model', 'image-combo']);
  });

  it('leaves the router in charge while it is working', async () => {
    const fallbackRequests: AiImageRequest[] = [];
    const agent = new ImageAgent(
      routerReturning([]),
      fallbackReturning(fallbackRequests),
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(fallbackRequests).toEqual([]);
  });

  it('reports the fallback failure when neither provider can deliver', async () => {
    const agent = new ImageAgent(
      routerReturning([], 1),
      fallbackReturning([], true),
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.ImageProviderRequestFailed);
  });

  it('fails on the router alone when no fallback is configured', async () => {
    const agent = new ImageAgent(
      routerReturning([], 1),
      null,
      recordingWorkspace([]),
      repositoryInto([]),
      imageConfig,
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AiRequestFailed);
  });
});
