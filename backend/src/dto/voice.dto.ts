import type { NarrationPlanDto } from './narration.dto.js';

/** Input for the Voice Agent. */
export interface VoiceRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /** Names the working directory the audio is written into. */
  readonly workflowId: string;
  readonly contentId: string;
  readonly plan: NarrationPlanDto;
  readonly language: string;
}

/**
 * The generated narration track.
 *
 * Metadata only: the audio lives in the run's working directory until the video
 * is rendered and is deleted afterwards, exactly like the stills.
 */
export interface VoiceDto {
  /** Always `narration.mp3`. */
  readonly fileName: string;
  /** Path relative to the workspace root, e.g. `audio/narration.mp3`. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly byteSize: number;
  readonly mimeType: string;
  /** Length of the assembled file, measured with ffprobe. */
  readonly durationSeconds: number;
  readonly voice: string;
  readonly model: string;
  readonly speed: number;
  readonly generationDurationMs: number;
}

/** Output of the Voice Agent. */
export interface VoiceGenerationResponseDto {
  readonly contentId: string;
  readonly workflowId: string;
  /** Absolute path of `output/workflows/{workflowId}/audio`. */
  readonly audioDirectory: string;
  readonly audio: VoiceDto;
  /**
   * The narration plan with **measured** block durations.
   *
   * The planner's numbers are an estimate from a words-per-minute rate; these
   * are what the speech engine actually produced. Everything timed against the
   * narration — the subtitles above all — must use this plan, not the estimate,
   * or it drifts a little further out of sync with every block.
   */
  readonly plan: NarrationPlanDto;
}
