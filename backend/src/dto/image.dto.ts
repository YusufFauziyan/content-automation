import type { VisualPromptDto } from './visual-prompt.dto.js';

/** Input for the Image Agent. */
export interface ImageGenerationRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /** Names the working directory the images are written into. */
  readonly workflowId: string;
  readonly contentId: string;
  /** One brief per scene, already assembled by the Visual Planner Agent. */
  readonly prompts: readonly VisualPromptDto[];
}

/**
 * One generated still.
 *
 * Only metadata: the bytes live on disk until the video is rendered and are
 * deleted afterwards, and they are never written to the database.
 */
export interface ImageDto {
  /** 1-based scene number the image illustrates. */
  readonly scene: number;
  /** File name, always `scene-NNN.png`. */
  readonly fileName: string;
  /** Path relative to the workspace root, e.g. `images/scene-001.png`. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  /** How long the router took to produce this image. */
  readonly generationDurationMs: number;
  /** Router combo that produced it, recorded for reproducibility. */
  readonly combo: string;
}

/** Output of the Image Agent: one image per scene, in scene order. */
export interface ImageGenerationResponseDto {
  readonly contentId: string;
  readonly workflowId: string;
  /** Absolute path of `output/workflows/{workflowId}/images`. */
  readonly imagesDirectory: string;
  readonly images: readonly ImageDto[];
  /** Wall-clock time spent generating every image in this set. */
  readonly totalDurationMs: number;
}
