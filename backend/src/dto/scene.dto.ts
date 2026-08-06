import type { ScriptDto } from './script.dto.js';

/** Camera treatment applied to a still image to create motion. */
export enum SceneCamera {
  Static = 'static',
  ZoomIn = 'zoom in',
  ZoomOut = 'zoom out',
  PanLeft = 'pan left',
  PanRight = 'pan right',
}

/** Transition between two consecutive scenes. */
export enum SceneTransition {
  Cut = 'cut',
  Fade = 'fade',
  Dissolve = 'dissolve',
}

/** Input for the Scene Agent. */
export interface ScenePlanRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  readonly script: ScriptDto;
  /** Total spoken length the scene durations must add up to. */
  readonly durationSeconds: number;
  /** Visual treatment applied consistently to every scene, e.g. `"cinematic"`. */
  readonly visualStyle: string;
}

/** One visual beat of the video. */
export interface SceneDto {
  /** 1-based position in the plan. */
  readonly scene: number;
  /** On-screen time in whole seconds. */
  readonly duration: number;
  /** The exact narration spoken during this scene. */
  readonly narration: string;
  /** Prompt handed to image generation. */
  readonly imagePrompt: string;
  readonly camera: SceneCamera;
  readonly transition: SceneTransition;
  readonly style: string;
}

/** Full scene plan; persisted as `contents.scene_plan`. */
export interface ScenePlanDto {
  /** Identifier of the `contents` row the plan was stored in. */
  readonly contentId: string;
  readonly scenes: readonly SceneDto[];
  readonly totalDurationSeconds: number;
}
