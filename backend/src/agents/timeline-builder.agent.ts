import type { BackgroundMusicConfig, VideoConfig } from '../config/app.config.js';
import {
  CameraMovement,
  TransitionEffect,
  type RenderPlanDto,
  type RenderPlanRequestDto,
  type RenderSceneDto,
} from '../dto/render-plan.dto.js';
import { SceneCamera, SceneTransition, type SceneDto } from '../dto/scene.dto.js';
import type { SubtitleCueDto } from '../dto/subtitle.dto.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Translation from the scene plan's vocabulary into the renderer's.
 *
 * The two are deliberately separate enums: a scene plan describes what the
 * video should feel like, a render plan describes what FFmpeg will do. Mapping
 * them here means neither has to change when the other gains a value.
 */
const CAMERA_BY_SCENE: Readonly<Record<SceneCamera, CameraMovement>> = {
  [SceneCamera.Static]: CameraMovement.Static,
  [SceneCamera.ZoomIn]: CameraMovement.ZoomIn,
  [SceneCamera.ZoomOut]: CameraMovement.ZoomOut,
  [SceneCamera.PanLeft]: CameraMovement.PanLeft,
  [SceneCamera.PanRight]: CameraMovement.PanRight,
};

const TRANSITION_BY_SCENE: Readonly<Record<SceneTransition, TransitionEffect>> = {
  [SceneTransition.Cut]: TransitionEffect.Cut,
  [SceneTransition.Fade]: TransitionEffect.Fade,
  [SceneTransition.Dissolve]: TransitionEffect.Crossfade,
};

/**
 * Stretches the scene durations so they span the narration exactly.
 *
 * The scene plan's durations are what the script *asked* for; the narration is
 * what was actually spoken, and the subtitles are timed against it. Scaling the
 * scenes to the real length is what stops the last image from ending while the
 * voice is still talking — or lingering after it has stopped.
 *
 * Exported so the rule can be tested on its own.
 */
export const scaleToDuration = (
  scenes: readonly SceneDto[],
  targetSeconds: number,
): readonly number[] => {
  const planned = scenes.reduce((total, scene) => total + scene.duration, 0);

  if (planned <= 0 || targetSeconds <= 0) {
    return scenes.map(() => targetSeconds / Math.max(1, scenes.length));
  }

  const factor = targetSeconds / planned;
  const scaled = scenes.map((scene) => scene.duration * factor);
  // The last scene absorbs the rounding, so the timeline ends exactly on time.
  const head = scaled.slice(0, -1);
  const used = head.reduce((total, value) => total + value, 0);

  return scenes.length === 0 ? [] : [...head, targetSeconds - used];
};

/** Cues that overlap a scene's span, in cue order. */
const cuesWithin = (
  cues: readonly SubtitleCueDto[],
  startSeconds: number,
  endSeconds: number,
): readonly SubtitleCueDto[] =>
  cues.filter(
    (cue) =>
      cue.endMs > startSeconds * MILLISECONDS_PER_SECOND &&
      cue.startMs < endSeconds * MILLISECONDS_PER_SECOND,
  );

/**
 * Turns everything a run has produced into one explicit render timeline.
 *
 * Purpose
 * - Decide when each still appears, how long it stays, how the camera moves
 *   across it, and which words are on screen while it does.
 *
 * Input
 * - {@link RenderPlanRequestDto}
 *
 * Output
 * - {@link RenderPlanDto}
 *
 * Dependencies
 * - `VideoConfig` — frame size, rate and the default camera travel.
 * - `BackgroundMusicConfig` — the optional music bed.
 *
 * This agent never calls FFmpeg. Separating the timeline from the render is
 * what makes a wrong video diagnosable: the plan can be read, compared against
 * the subtitle file, and corrected without spending a render.
 */
export class TimelineBuilderAgent implements Agent<RenderPlanRequestDto, RenderPlanDto> {
  public readonly name = 'TimelineBuilderAgent';

  constructor(
    private readonly videoConfig: VideoConfig,
    private readonly musicConfig: BackgroundMusicConfig,
    private readonly logger: Logger,
  ) {}

  public async execute(input: RenderPlanRequestDto): Promise<Result<RenderPlanDto>> {
    const logger = this.logger.child({
      source: this.name,
      correlationId: input.correlationId,
      workflowRunId: input.workflowId,
      step: WorkflowStepName.RenderPlan,
    });
    const startedAt = Date.now();
    logger.info('START');

    try {
      const plan = this.build(input);

      logger.info('SUCCESS', {
        durationMs: Date.now() - startedAt,
        sceneCount: plan.scenes.length,
        totalDuration: plan.totalDuration,
        hasBackgroundMusic: plan.audio.backgroundMusicPath !== null,
      });

      return await Promise.resolve(ok(plan));
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /** Lays every scene, camera move and caption onto one timeline. */
  private build(input: RenderPlanRequestDto): RenderPlanDto {
    const scenes = input.scenePlan.scenes;

    if (scenes.length === 0) {
      throw new AgentOutputInvalidError(this.name, 'the scene plan is empty');
    }

    const imageByScene = new Map(input.images.map((image) => [image.scene, image]));
    // Resolved up front so the loop below has a total mapping to work from:
    // a scene with no still is a hole in the video, not something to skip.
    const imagePaths = scenes.map((scene) => imageByScene.get(scene.scene)?.absolutePath);
    const missing = scenes.filter((_scene, index) => imagePaths[index] === undefined);

    if (missing.length > 0) {
      throw new AgentOutputInvalidError(this.name, 'a scene has no image to show', {
        scenes: missing.map((scene) => scene.scene),
      });
    }

    // The subtitles are the authority on length: they were timed against the
    // narration the viewer will actually hear.
    const totalDuration =
      input.subtitle.subtitle.totalDurationMs > 0
        ? input.subtitle.subtitle.totalDurationMs / MILLISECONDS_PER_SECOND
        : input.narrationPlan.totalDurationSeconds;

    if (totalDuration <= 0) {
      throw new AgentOutputInvalidError(this.name, 'the narration has no duration');
    }

    const durations = scaleToDuration(scenes, totalDuration);
    const rendered: RenderSceneDto[] = [];
    let cursor = 0;

    scenes.forEach((scene, index) => {
      const duration = durations[index] ?? 0;
      const startTime = cursor;
      const endTime = index === scenes.length - 1 ? totalDuration : startTime + duration;
      const cues = cuesWithin(input.subtitle.cues, startTime, endTime);

      rendered.push({
        scene: scene.scene,
        imagePath: imagePaths[index] ?? '',
        startTime: round(startTime),
        endTime: round(endTime),
        duration: round(endTime - startTime),
        cameraMovement: CAMERA_BY_SCENE[scene.camera],
        cameraSpeed: this.videoConfig.cameraIntensity,
        transition: TRANSITION_BY_SCENE[scene.transition],
        subtitleStart: round(
          (cues[0]?.startMs ?? startTime * MILLISECONDS_PER_SECOND) / MILLISECONDS_PER_SECOND,
        ),
        subtitleEnd: round(
          (cues[cues.length - 1]?.endMs ?? endTime * MILLISECONDS_PER_SECOND) /
            MILLISECONDS_PER_SECOND,
        ),
        subtitleText: cues.flatMap((cue) => cue.lines).join('\n'),
      });

      cursor = endTime;
    });

    return {
      contentId: input.contentId,
      workflowId: input.workflowId,
      width: this.videoConfig.width,
      height: this.videoConfig.height,
      fps: this.videoConfig.fps,
      totalDuration: round(totalDuration),
      scenes: rendered,
      audio: {
        narrationPath: input.voice.audio.absolutePath,
        backgroundMusicPath: this.musicConfig.path,
        backgroundMusicVolume: this.musicConfig.volume,
      },
      subtitlePath: input.subtitle.subtitle.absolutePath,
      transitionDuration: this.videoConfig.transitionSeconds,
    };
  }
}

/** Keeps timeline values to milliseconds; anything finer is noise in a filter. */
const round = (seconds: number): number => Math.round(seconds * 1000) / 1000;
