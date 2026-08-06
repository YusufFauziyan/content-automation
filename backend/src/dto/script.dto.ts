import type { TopicDto } from './topic.dto.js';

/** Input for the Script Agent. */
export interface ScriptRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  readonly topic: TopicDto;
  /** Spoken length the narration is written for. */
  readonly durationSeconds: number;
  readonly audience: string;
}

/** What the model is asked to author, before anything is persisted. */
export interface ScriptDraftDto {
  readonly title: string;
  /** First spoken line; the reason a viewer stays. */
  readonly hook: string;
  /** Full narration, including the hook. */
  readonly script: string;
  readonly caption: string;
  readonly hashtags: readonly string[];
  /** Prompt handed to image generation for the thumbnail. */
  readonly thumbnailPrompt: string;
}

/** Output of the Script Agent: the authored script, already persisted. */
export interface ScriptDto extends ScriptDraftDto {
  /** Identifier of the `contents` row the script was stored in. */
  readonly contentId: string;
  readonly topicId: string;
  readonly language: string;
  readonly durationSeconds: number;
}
