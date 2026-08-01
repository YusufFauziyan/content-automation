import type { ScenePlanDto } from './scene.dto.js';

/** Input for the Visual Planner Agent. */
export interface VisualPlanRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /**
   * The whole plan, not one scene.
   *
   * Consistency between scenes is one of the things the planner is responsible
   * for, and that cannot be decided while looking at a single scene.
   */
  readonly scenePlan: ScenePlanDto;
  /** Visual treatment requested for the video. */
  readonly visualStyle: string;
  /** Aspect ratio the images are generated at, e.g. `"9:16"`. */
  readonly aspectRatio: string;
}

/**
 * A fully specified image brief for one scene.
 *
 * The scene plan's `imagePrompt` is a sentence; this is a brief. Every axis an
 * image model actually responds to is named separately so that the assembled
 * prompt is reproducible and each part can be inspected or corrected on its
 * own.
 */
export interface VisualPromptDto {
  /** 1-based scene number, matching `SceneDto.scene`. */
  readonly scene: number;
  readonly subject: string;
  readonly environment: string;
  readonly lighting: string;
  readonly cameraAngle: string;
  readonly lens: string;
  readonly composition: string;
  readonly visualStyle: string;
  readonly colorPalette: string;
  readonly quality: string;
  readonly aspectRatio: string;
  /**
   * What must look the same as in the other scenes — recurring characters,
   * wardrobe, palette, era. This is what stops a video from looking like eight
   * unrelated pictures.
   */
  readonly consistency: string;
  /** What must not appear in the frame. */
  readonly negative: string;
  /**
   * The assembled prompt, rendered from the fields above.
   *
   * The Image Agent sends this verbatim; it never edits or rebuilds it.
   */
  readonly prompt: string;
}

/** Output of the Visual Planner Agent: one brief per scene, in scene order. */
export interface VisualPlanDto {
  /** Identifier of the `contents` row the plan was stored in. */
  readonly contentId: string;
  readonly prompts: readonly VisualPromptDto[];
}
