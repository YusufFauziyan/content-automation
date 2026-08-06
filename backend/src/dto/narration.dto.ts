import type { ScriptDto } from './script.dto.js';

/** How forcefully a block is meant to be read. */
export enum NarrationEmphasis {
  Soft = 'soft',
  Normal = 'normal',
  Strong = 'strong',
}

/** Input for the Narration Planner Agent. */
export interface NarrationPlanRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  readonly script: ScriptDto;
  /** Spoken length the narration is written for. */
  readonly durationSeconds: number;
}

/**
 * One spoken unit of the narration.
 *
 * A block is simultaneously a unit of speech and a unit of subtitle: the audio
 * reads it as one breath and the `.srt` shows it as one cue. Keeping them the
 * same object is what makes the two artefacts agree without a transcription
 * step to reconcile them.
 */
export interface NarrationBlockDto {
  /** 1-based position in the narration. */
  readonly id: number;
  /** Exactly the words that are spoken. */
  readonly text: string;
  /** How long the block takes to read, in seconds. */
  readonly estimatedDuration: number;
  /** Silence held after the block, in seconds. */
  readonly pauseAfter: number;
  readonly emphasis: NarrationEmphasis;
}

/** Output of the Narration Planner Agent; persisted as `contents.narration_plan`. */
export interface NarrationPlanDto {
  /** Identifier of the `contents` row the plan was stored in. */
  readonly contentId: string;
  readonly blocks: readonly NarrationBlockDto[];
  /** Speech plus pauses, in seconds. */
  readonly totalDurationSeconds: number;
}
