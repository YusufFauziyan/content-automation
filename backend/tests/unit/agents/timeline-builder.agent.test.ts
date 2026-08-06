import { describe, expect, it } from 'vitest';

import {
  TimelineBuilderAgent,
  scaleToDuration,
} from '../../../src/agents/timeline-builder.agent.js';
import type { BackgroundMusicConfig, VideoConfig } from '../../../src/config/app.config.js';
import type { ImageDto } from '../../../src/dto/image.dto.js';
import type { NarrationPlanDto } from '../../../src/dto/narration.dto.js';
import { CameraMovement, TransitionEffect } from '../../../src/dto/render-plan.dto.js';
import { SceneCamera, SceneTransition, type SceneDto } from '../../../src/dto/scene.dto.js';
import type {
  SubtitleCueDto,
  SubtitleDto,
  SubtitleGenerationResponseDto,
} from '../../../src/dto/subtitle.dto.js';
import type { VoiceDto, VoiceGenerationResponseDto } from '../../../src/dto/voice.dto.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { asFake } from '../../support/fakes.js';

const videoConfig: VideoConfig = {
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  preset: 'medium',
  crf: 23,
  cameraIntensity: 0.12,
  transitionSeconds: 0.5,
  subtitleBottomFraction: 0.16,
  coverAtFraction: 0.35,
  timeoutMs: 900_000,
  retry: { maxRetries: 2, backoffMs: [1, 1] },
};

const noMusic: BackgroundMusicConfig = { path: null, volume: 0.12 };

const scene = (
  number: number,
  duration: number,
  camera: SceneCamera = SceneCamera.ZoomIn,
  transition: SceneTransition = SceneTransition.Cut,
): SceneDto => ({
  scene: number,
  duration,
  narration: `Narration ${String(number)}`,
  imagePrompt: `Image ${String(number)}`,
  camera,
  transition,
  style: 'cinematic',
});

const image = (number: number): ImageDto =>
  asFake<ImageDto>({ scene: number, absolutePath: `/tmp/images/scene-00${String(number)}.png` });

const cue = (index: number, startMs: number, endMs: number, lines: string[]): SubtitleCueDto => ({
  index,
  startMs,
  endMs,
  lines,
});

const buildRequest = (
  scenes: readonly SceneDto[],
  cues: readonly SubtitleCueDto[],
  totalDurationMs: number,
): Parameters<TimelineBuilderAgent['execute']>[0] => ({
  correlationId: 'run-1',
  workflowId: 'workflow-1',
  contentId: 'content-1',
  scenePlan: {
    contentId: 'content-1',
    scenes,
    totalDurationSeconds: scenes.reduce((total, item) => total + item.duration, 0),
  },
  images: scenes.map((item) => image(item.scene)),
  narrationPlan: asFake<NarrationPlanDto>({
    contentId: 'content-1',
    blocks: [],
    totalDurationSeconds: totalDurationMs / 1000,
  }),
  voice: asFake<VoiceGenerationResponseDto>({
    audio: asFake<VoiceDto>({ absolutePath: '/tmp/audio/narration.mp3' }),
  }),
  subtitle: asFake<SubtitleGenerationResponseDto>({
    subtitle: asFake<SubtitleDto>({
      absolutePath: '/tmp/subtitle/subtitle.srt',
      totalDurationMs,
    }),
    cues,
  }),
});

const createAgent = (music: BackgroundMusicConfig = noMusic): TimelineBuilderAgent =>
  new TimelineBuilderAgent(videoConfig, music, new NoopLogger());

describe('scaleToDuration', () => {
  it('stretches scenes to span the narration exactly', () => {
    const scaled = scaleToDuration([scene(1, 5), scene(2, 5)], 20);

    expect(scaled.reduce((total, value) => total + value, 0)).toBeCloseTo(20, 6);
  });

  it('keeps the relative weight of each scene', () => {
    const scaled = scaleToDuration([scene(1, 1), scene(2, 3)], 8);

    expect(scaled[0]).toBeCloseTo(2, 6);
    expect(scaled[1]).toBeCloseTo(6, 6);
  });

  it('shortens scenes when the narration came in under the plan', () => {
    const scaled = scaleToDuration([scene(1, 10), scene(2, 10)], 10);

    expect(scaled.reduce((total, value) => total + value, 0)).toBeCloseTo(10, 6);
  });

  it('divides evenly when the plan has no duration at all', () => {
    const scaled = scaleToDuration([scene(1, 0), scene(2, 0)], 10);

    expect(scaled).toEqual([5, 5]);
  });
});

describe('TimelineBuilderAgent', () => {
  it('places scenes back to back, starting at zero', async () => {
    const request = buildRequest([scene(1, 5), scene(2, 5)], [cue(1, 0, 10000, ['Hello'])], 10000);

    const result = await createAgent().execute(request);
    const scenes = result.success ? result.data.scenes : [];

    expect(scenes[0]?.startTime).toBe(0);
    expect(scenes[0]?.endTime).toBe(scenes[1]?.startTime);
  });

  it('makes the timeline span exactly the subtitle length', async () => {
    const request = buildRequest([scene(1, 3), scene(2, 7)], [cue(1, 0, 21600, ['Hello'])], 21600);

    const result = await createAgent().execute(request);
    const plan = result.success ? result.data : null;

    expect(plan?.totalDuration).toBe(21.6);
    expect(plan?.scenes[plan.scenes.length - 1]?.endTime).toBe(21.6);
  });

  it('carries the frame size and rate from configuration', async () => {
    const request = buildRequest([scene(1, 5)], [cue(1, 0, 5000, ['Hello'])], 5000);

    const result = await createAgent().execute(request);

    expect(result.success ? result.data.width : 0).toBe(1080);
    expect(result.success ? result.data.height : 0).toBe(1920);
    expect(result.success ? result.data.fps : 0).toBe(30);
  });

  it('translates the scene vocabulary into the renderer vocabulary', async () => {
    const request = buildRequest(
      [
        scene(1, 5, SceneCamera.PanLeft, SceneTransition.Dissolve),
        scene(2, 5, SceneCamera.Static, SceneTransition.Fade),
      ],
      [cue(1, 0, 10000, ['Hello'])],
      10000,
    );

    const result = await createAgent().execute(request);
    const scenes = result.success ? result.data.scenes : [];

    expect(scenes[0]?.cameraMovement).toBe(CameraMovement.PanLeft);
    expect(scenes[0]?.transition).toBe(TransitionEffect.Crossfade);
    expect(scenes[1]?.cameraMovement).toBe(CameraMovement.Static);
    expect(scenes[1]?.transition).toBe(TransitionEffect.Fade);
  });

  it('points each scene at its own image', async () => {
    const request = buildRequest([scene(1, 5), scene(2, 5)], [cue(1, 0, 10000, ['Hello'])], 10000);

    const result = await createAgent().execute(request);
    const scenes = result.success ? result.data.scenes : [];

    expect(scenes[0]?.imagePath).toBe('/tmp/images/scene-001.png');
    expect(scenes[1]?.imagePath).toBe('/tmp/images/scene-002.png');
  });

  it('attaches the captions that fall inside each scene', async () => {
    const request = buildRequest(
      [scene(1, 5), scene(2, 5)],
      [cue(1, 0, 4000, ['First line']), cue(2, 6000, 10000, ['Second line'])],
      10000,
    );

    const result = await createAgent().execute(request);
    const scenes = result.success ? result.data.scenes : [];

    expect(scenes[0]?.subtitleText).toBe('First line');
    expect(scenes[0]?.subtitleStart).toBe(0);
    expect(scenes[1]?.subtitleText).toBe('Second line');
    expect(scenes[1]?.subtitleEnd).toBe(10);
  });

  it('omits the music track when none is configured', async () => {
    const request = buildRequest([scene(1, 5)], [cue(1, 0, 5000, ['Hello'])], 5000);

    const result = await createAgent().execute(request);

    expect(result.success ? result.data.audio.backgroundMusicPath : 'x').toBeNull();
  });

  it('includes the music track when one is configured', async () => {
    const request = buildRequest([scene(1, 5)], [cue(1, 0, 5000, ['Hello'])], 5000);

    const result = await createAgent({ path: '/tmp/music/bed.mp3', volume: 0.2 }).execute(request);

    expect(result.success ? result.data.audio.backgroundMusicPath : null).toBe(
      '/tmp/music/bed.mp3',
    );
    expect(result.success ? result.data.audio.backgroundMusicVolume : 0).toBe(0.2);
  });

  it('refuses a scene that has no image', async () => {
    const request = buildRequest([scene(1, 5), scene(2, 5)], [cue(1, 0, 10000, ['Hello'])], 10000);
    const withoutSecond = { ...request, images: [image(1)] };

    const result = await createAgent().execute(withoutSecond);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.AgentOutputInvalid);
  });

  it('refuses an empty scene plan', async () => {
    const request = buildRequest([], [], 10000);

    const result = await createAgent().execute(request);

    expect(result.success).toBe(false);
  });

  it('refuses a narration with no duration', async () => {
    const request = buildRequest([scene(1, 5)], [], 0);
    const silent = {
      ...request,
      narrationPlan: asFake<NarrationPlanDto>({ contentId: 'content-1', totalDurationSeconds: 0 }),
    };

    const result = await createAgent().execute(silent);

    expect(result.success).toBe(false);
  });
});
