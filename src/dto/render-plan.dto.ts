import type { ImageDto } from './image.dto.js';
import type { NarrationPlanDto } from './narration.dto.js';
import type { ScenePlanDto } from './scene.dto.js';
import type { SubtitleGenerationResponseDto } from './subtitle.dto.js';
import type { VoiceGenerationResponseDto } from './voice.dto.js';

/**
 * Motion applied to a still while it is on screen.
 *
 * A short-form video made of stills is only watchable because the frame keeps
 * moving; these are the moves the renderer knows how to perform.
 */
export enum CameraMovement {
  Static = 'static',
  ZoomIn = 'zoom_in',
  ZoomOut = 'zoom_out',
  PanLeft = 'pan_left',
  PanRight = 'pan_right',
}

/** How one scene gives way to the next. */
export enum TransitionEffect {
  /** An instant change of frame. */
  Cut = 'cut',
  /** Through black. */
  Fade = 'fade',
  /** One image dissolving into the next. */
  Crossfade = 'crossfade',
}

/** Input for the Timeline Builder Agent. */
export interface RenderPlanRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /** Names the working directory the video is written into. */
  readonly workflowId: string;
  readonly contentId: string;
  readonly scenePlan: ScenePlanDto;
  readonly images: readonly ImageDto[];
  readonly narrationPlan: NarrationPlanDto;
  readonly voice: VoiceGenerationResponseDto;
  readonly subtitle: SubtitleGenerationResponseDto;
}

/**
 * One scene, placed on the timeline.
 *
 * Every field is an instruction, not a hint: the renderer performs exactly what
 * is written here and decides nothing. That is what makes a render reproducible
 * and a bad frame diagnosable — the plan can be read on its own and compared
 * against the result.
 */
export interface RenderSceneDto {
  /** 1-based scene number. */
  readonly scene: number;
  /** Absolute path of the still to show. */
  readonly imagePath: string;
  /** Seconds from the start of the video. */
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly cameraMovement: CameraMovement;
  /**
   * How far the camera travels over the scene, as a fraction of the frame.
   *
   * Carried per scene rather than read from configuration by the renderer, so
   * a plan fully describes its own output.
   */
  readonly cameraSpeed: number;
  readonly transition: TransitionEffect;
  /** Seconds from the start of the video; equal to `startTime` when absent. */
  readonly subtitleStart: number;
  readonly subtitleEnd: number;
  /** The words shown during this scene, already broken for the screen. */
  readonly subtitleText: string;
}

/** Audio tracks laid over the timeline. */
export interface RenderAudioDto {
  /** Absolute path of the narration track. */
  readonly narrationPath: string;
  /**
   * Absolute path of the music bed, or `null`.
   *
   * `null` is a supported state: the renderer omits the track rather than
   * failing (PROJECT_RULES.md — a missing optional input is not an error).
   */
  readonly backgroundMusicPath: string | null;
  /** Gain applied to the music, relative to the narration. */
  readonly backgroundMusicVolume: number;
}

/**
 * The complete instruction for one render.
 *
 * Output of the Timeline Builder Agent and the only input the composer needs:
 * given this DTO and the files it points at, the video is fully determined.
 */
export interface RenderPlanDto {
  readonly contentId: string;
  readonly workflowId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Length of the finished video, in seconds. */
  readonly totalDuration: number;
  readonly scenes: readonly RenderSceneDto[];
  readonly audio: RenderAudioDto;
  /** Absolute path of the burned-in subtitle file. */
  readonly subtitlePath: string;
  /** Length of a fade or crossfade, in seconds. */
  readonly transitionDuration: number;
}
