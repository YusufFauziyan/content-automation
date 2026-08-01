import type { RenderPlanDto } from './render-plan.dto.js';

/** Input for the FFmpeg Composer Agent. */
export interface VideoRenderRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /** Names the working directory the video is written into. */
  readonly workflowId: string;
  readonly contentId: string;
  /** The complete instruction. The composer adds nothing to it. */
  readonly plan: RenderPlanDto;
}

/**
 * The rendered video.
 *
 * Metadata only. `durationMs`, `width` and `height` are *measured* from the
 * container rather than copied from the plan: what was asked for and what came
 * out are different questions, and the quality check exists to compare them.
 */
export interface VideoDto {
  /** Always `final.mp4`. */
  readonly fileName: string;
  /** Path relative to the workspace root, e.g. `video/final.mp4`. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Measured length of the container, in milliseconds. */
  readonly durationMs: number;
  readonly videoCodec: string;
  readonly audioCodec: string;
  /** Wall-clock time FFmpeg took. */
  readonly renderDurationMs: number;
  /** Whether a music bed was mixed in. */
  readonly hasBackgroundMusic: boolean;
}

/** Output of the FFmpeg Composer Agent. */
export interface VideoRenderResponseDto {
  readonly contentId: string;
  readonly workflowId: string;
  /** Absolute path of `output/workflows/{workflowId}/video`. */
  readonly videoDirectory: string;
  readonly video: VideoDto;
}
