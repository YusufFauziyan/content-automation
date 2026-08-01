import type { NarrationPlanDto } from './narration.dto.js';

/** Input for the Subtitle Agent. */
export interface SubtitleRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /** Names the working directory the subtitle file is written into. */
  readonly workflowId: string;
  readonly contentId: string;
  readonly plan: NarrationPlanDto;
}

/**
 * One subtitle cue.
 *
 * Times are milliseconds from the start of the narration, which is the unit
 * SRT is written in and the unit the composer will hand to FFmpeg. `lines` is
 * already broken for the screen — a cue that still needed wrapping would let
 * the reader's constraint leak into whoever renders it.
 */
export interface SubtitleCueDto {
  /** 1-based cue number, as written in the file. */
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  /** At most two lines, each within the readable length. */
  readonly lines: readonly string[];
}

/**
 * The generated subtitle file.
 *
 * Metadata only; the `.srt` itself is disposable like every other artefact.
 */
export interface SubtitleDto {
  /** Always `subtitle.srt`. */
  readonly fileName: string;
  /** Path relative to the workspace root, e.g. `subtitle/subtitle.srt`. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly byteSize: number;
  readonly cueCount: number;
  /** End of the last cue, in milliseconds. */
  readonly totalDurationMs: number;
}

/** Output of the Subtitle Agent. */
export interface SubtitleGenerationResponseDto {
  readonly contentId: string;
  readonly workflowId: string;
  /** Absolute path of `output/workflows/{workflowId}/subtitle`. */
  readonly subtitleDirectory: string;
  readonly subtitle: SubtitleDto;
  readonly cues: readonly SubtitleCueDto[];
}
