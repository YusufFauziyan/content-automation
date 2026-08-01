import { describe, expect, it } from 'vitest';

import { toBlockFileName, toMeasuredBlocks, VoiceAgent } from '../../../src/agents/voice.agent.js';
import type { ContentDto, ContentUpdateDto } from '../../../src/dto/content.dto.js';
import {
  NarrationEmphasis,
  type NarrationBlockDto,
  type NarrationPlanDto,
} from '../../../src/dto/narration.dto.js';
import type { VoiceRequestDto } from '../../../src/dto/voice.dto.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type {
  AudioSegmentDto,
  FfmpegService,
  MediaProbeResult,
} from '../../../src/services/ffmpeg.service.js';
import type { KokoroService, SpeechRequest } from '../../../src/services/kokoro.service.js';
import {
  WorkspaceFolder,
  type StoredFileDto,
  type WorkingDirectoryService,
  type WorkspaceDto,
} from '../../../src/services/working-directory.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { SpeechServiceError } from '../../../src/types/errors/speech.error.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const block = (id: number, text: string, pauseAfter = 0.3): NarrationBlockDto => ({
  id,
  text,
  estimatedDuration: 2,
  pauseAfter,
  emphasis: NarrationEmphasis.Normal,
});

const plan: NarrationPlanDto = {
  contentId: 'content-1',
  blocks: [block(1, 'First sentence.'), block(2, 'Second sentence.', 0)],
  totalDurationSeconds: 4.3,
};

const request: VoiceRequestDto = {
  correlationId: 'run-1',
  workflowId: 'workflow-1',
  contentId: 'content-1',
  plan,
  language: 'en',
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

const kokoroReturning = (requests: SpeechRequest[], failing = false): KokoroService => ({
  synthesize: (speechRequest) => {
    requests.push(speechRequest);

    if (failing) {
      return Promise.reject(new SpeechServiceError('server refused', false));
    }

    return Promise.resolve({
      data: new Uint8Array(2048),
      mimeType: 'audio/mpeg',
      voice: 'af_heart',
      model: 'kokoro',
      speed: 1,
    });
  },
});

/**
 * An FFmpeg that reports a different length for every clip.
 *
 * The estimates in `plan` are all 2 seconds, so anything the agent copies from
 * the plan instead of measuring stands out immediately.
 */
const ffmpegMeasuring = (
  durationsMs: readonly number[],
  segments: AudioSegmentDto[][] = [],
): FfmpegService => {
  let call = 0;

  return asFake<FfmpegService>({
    concatAudio: (given) => {
      segments.push([...given]);
      return Promise.resolve();
    },
    probe: () => {
      const durationMs = durationsMs[call] ?? 0;
      call += 1;

      return Promise.resolve(asFake<MediaProbeResult>({ durationMs, width: 0, height: 0, fps: 0 }));
    },
  });
};

const contentRepositoryInto = (updates: ContentUpdateDto[]): ContentRepository =>
  asFake<ContentRepository>({
    update: (_id, input) => {
      updates.push(input);
      return Promise.resolve(asFake<ContentDto>({ id: 'content-1' }));
    },
  });

describe('toBlockFileName', () => {
  it('numbers a block to three digits so the clips sort in spoken order', () => {
    expect(toBlockFileName(1)).toBe('block-001.mp3');
    expect(toBlockFileName(12)).toBe('block-012.mp3');
  });
});

describe('toMeasuredBlocks', () => {
  it('replaces the predicted length with the measured one', () => {
    const measured = toMeasuredBlocks([block(1, 'One.'), block(2, 'Two.')], [1234, 5678]);

    expect(measured.map((given) => given.estimatedDuration)).toEqual([1.234, 5.678]);
  });

  it('keeps everything else about the block', () => {
    const measured = toMeasuredBlocks([block(1, 'One.', 0.4)], [1000]);

    expect(measured[0]).toMatchObject({ id: 1, text: 'One.', pauseAfter: 0.4 });
  });
});

describe('VoiceAgent', () => {
  it('speaks every block on its own so each one can be measured', async () => {
    // One request for the whole narration would be cheaper, but then only the
    // total length is knowable and the captions drift block by block.
    const requests: SpeechRequest[] = [];
    const agent = new VoiceAgent(
      kokoroReturning(requests),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(requests.map((given) => given.text)).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('writes one clip per block, then narration.mp3', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; byteSize: number }[] = [];
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace(written),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(true);
    expect(written.map((given) => given.fileName)).toEqual(['block-001.mp3', 'block-002.mp3']);
  });

  it('joins the clips with exactly the silence the plan asks for', async () => {
    const segments: AudioSegmentDto[][] = [];
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300], segments),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(segments[0]).toEqual([
      { kind: 'speech', path: `${workspace.root}/audio/block-001.mp3` },
      { kind: 'silence', seconds: 0.3 },
      { kind: 'speech', path: `${workspace.root}/audio/block-002.mp3` },
    ]);
  });

  it('reports measured block lengths, not the planner estimates', async () => {
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);
    const blocks = result.success ? result.data.plan.blocks : [];

    expect(blocks.map((given) => given.estimatedDuration)).toEqual([1, 2]);
  });

  it('reports a total that matches the clips and their silences', async () => {
    // 1s + 0.3s pause + 2s. If this ever came from the plan it would be 4.3.
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success ? result.data.plan.totalDurationSeconds : null).toBe(3.3);
  });

  it('persists the measured plan so a resumed run keeps the timing', async () => {
    const updates: ContentUpdateDto[] = [];
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace([]),
      contentRepositoryInto(updates),
      new NoopLogger(),
    );

    await agent.execute(request);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.narrationBlocks?.map((given) => given.estimatedDuration)).toEqual([1, 2]);
  });

  it('records what produced the audio', async () => {
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success ? result.data.audio : null).toMatchObject({
      fileName: 'narration.mp3',
      relativePath: 'audio/narration.mp3',
      mimeType: 'audio/mpeg',
      voice: 'af_heart',
      model: 'kokoro',
      durationSeconds: 3.3,
    });
  });

  it('reports the audio directory of the run', async () => {
    const agent = new VoiceAgent(
      kokoroReturning([]),
      ffmpegMeasuring([1000, 2000, 3300]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success ? result.data.audioDirectory : null).toBe(
      workspace.folders[WorkspaceFolder.Audio],
    );
  });

  it('returns a typed failure when the server refuses', async () => {
    const agent = new VoiceAgent(
      kokoroReturning([], true),
      ffmpegMeasuring([1000]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.SpeechRequestFailed);
  });

  it('refuses a plan with nothing to say, without calling the server', async () => {
    const requests: SpeechRequest[] = [];
    const agent = new VoiceAgent(
      kokoroReturning(requests),
      ffmpegMeasuring([1000]),
      recordingWorkspace([]),
      contentRepositoryInto([]),
      new NoopLogger(),
    );

    const result = await agent.execute({
      ...request,
      plan: { ...plan, blocks: [block(1, '  ')] },
    });

    expect(result.success).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
