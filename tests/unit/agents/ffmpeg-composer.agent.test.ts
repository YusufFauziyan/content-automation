import { describe, expect, it } from 'vitest';

import { FfmpegComposerAgent, VIDEO_FILE_NAME } from '../../../src/agents/ffmpeg-composer.agent.js';
import type { RenderPlanDto } from '../../../src/dto/render-plan.dto.js';
import type { VideoRenderRequestDto } from '../../../src/dto/video.dto.js';
import type {
  NewRenderedVideoDto,
  RenderedVideoDto,
  VideoRepository,
} from '../../../src/repositories/video.repository.js';
import type {
  FfmpegService,
  MediaProbeResult,
  RenderResult,
} from '../../../src/services/ffmpeg.service.js';
import {
  WorkspaceFolder,
  type StoredFileDto,
  type WorkingDirectoryService,
  type WorkspaceDto,
} from '../../../src/services/working-directory.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { RenderError } from '../../../src/types/errors/render.error.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

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

const plan = asFake<RenderPlanDto>({
  contentId: 'content-1',
  workflowId: 'workflow-1',
  width: 1080,
  height: 1920,
  fps: 30,
  totalDuration: 21.6,
  scenes: [],
});

const request: VideoRenderRequestDto = {
  correlationId: 'run-1',
  workflowId: 'workflow-1',
  contentId: 'content-1',
  plan,
};

const healthyProbe: MediaProbeResult = {
  durationMs: 21_600,
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
};

const workspaceService = (): WorkingDirectoryService => ({
  prepare: () => Promise.resolve(workspace),
  write: () => Promise.reject(new Error('the composer never writes through the workspace')),
  resolve: (_workspace, folder, fileName) => `${workspace.folders[folder]}/${fileName}`,
  describe: (_workspace, folder, fileName) =>
    Promise.resolve<StoredFileDto>({
      fileName,
      relativePath: `${folder}/${fileName}`,
      absolutePath: `${workspace.folders[folder]}/${fileName}`,
      byteSize: 2_400_000,
    }),
  remove: () => Promise.resolve(),
});

const ffmpegReturning = (
  probe: MediaProbeResult,
  rendered: RenderResult = { renderDurationMs: 4321, hasBackgroundMusic: false },
  failure?: Error,
): { service: FfmpegService; outputs: string[] } => {
  const outputs: string[] = [];

  return {
    outputs,
    service: {
      render: (_plan, outputPath) => {
        outputs.push(outputPath);
        return failure === undefined ? Promise.resolve(rendered) : Promise.reject(failure);
      },
      concatAudio: () => Promise.resolve(),
      probe: () => Promise.resolve(probe),
    },
  };
};

const repositoryInto = (saved: NewRenderedVideoDto[]): VideoRepository =>
  asFake<VideoRepository>({
    save: (input) => {
      saved.push(input);
      return Promise.resolve(asFake<RenderedVideoDto>({ id: 'video-1' }));
    },
  });

describe('FfmpegComposerAgent', () => {
  it('renders into video/final.mp4 of the run workspace', async () => {
    const { service, outputs } = ffmpegReturning(healthyProbe);
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(outputs).toEqual(['/tmp/out/workflows/workflow-1/video/final.mp4']);
    expect(result.success ? result.data.video.fileName : null).toBe(VIDEO_FILE_NAME);
  });

  it('hands the plan through untouched', async () => {
    let seen: RenderPlanDto | null = null;
    const service: FfmpegService = {
      render: (given) => {
        seen = given;
        return Promise.resolve({ renderDurationMs: 1, hasBackgroundMusic: false });
      },
      concatAudio: () => Promise.resolve(),
      probe: () => Promise.resolve(healthyProbe),
    };
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto([]),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(seen).toBe(plan);
  });

  it('reports what the file measures, not what the plan asked for', async () => {
    // The plan wanted 21.6s at 1080x1920; the container came out different.
    const { service } = ffmpegReturning({ ...healthyProbe, durationMs: 20_100, height: 1080 });
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);
    const video = result.success ? result.data.video : null;

    expect(video?.durationMs).toBe(20_100);
    expect(video?.height).toBe(1080);
  });

  it('records the metadata, and never the container', async () => {
    const saved: NewRenderedVideoDto[] = [];
    const { service } = ffmpegReturning(healthyProbe);
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto(saved),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      contentId: 'content-1',
      workflowRunId: 'workflow-1',
      fileName: 'final.mp4',
      relativePath: 'video/final.mp4',
      byteSize: 2_400_000,
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 21_600,
      videoCodec: 'h264',
      renderDurationMs: 4321,
    });
  });

  it('reports how long the render took', async () => {
    const { service } = ffmpegReturning(healthyProbe);
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success ? result.data.video.renderDurationMs : 0).toBe(4321);
  });

  it('returns a typed failure when FFmpeg refuses', async () => {
    const { service } = ffmpegReturning(
      healthyProbe,
      undefined,
      new RenderError('bad filter graph', false),
    );
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.RenderFailed);
  });

  it('rejects a file that contains no usable video', async () => {
    const saved: NewRenderedVideoDto[] = [];
    const { service } = ffmpegReturning({ ...healthyProbe, durationMs: 0, width: 0 });
    const agent = new FfmpegComposerAgent(
      service,
      workspaceService(),
      repositoryInto(saved),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
    expect(saved).toHaveLength(0);
  });
});
