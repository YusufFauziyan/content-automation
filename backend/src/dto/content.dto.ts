import type { NarrationBlockDto } from './narration.dto.js';
import type { SceneDto } from './scene.dto.js';
import type { VisualPromptDto } from './visual-prompt.dto.js';

/** Input accepted by `ContentRepository.create`. */
export interface NewContentDto {
  readonly topicId: string;
  readonly title: string;
  readonly hook: string | null;
  readonly script: string;
  readonly caption: string | null;
  readonly hashtags: readonly string[];
  readonly thumbnailPrompt: string | null;
  readonly language: string;
  readonly targetDurationSeconds: number | null;
}

/** Fields that may be revised after the content row exists. */
export interface ContentUpdateDto {
  readonly caption?: string;
  readonly hashtags?: readonly string[];
  readonly thumbnailPrompt?: string;
  /**
   * Scene list as stored in the `scene_plan` JSON column.
   *
   * Only the scenes are persisted: the total is derived from them, and storing
   * a derived value invites the two to disagree.
   */
  readonly scenes?: readonly SceneDto[];
  /**
   * Image briefs as stored in the `visual_plan` JSON column.
   *
   * Persisted so a resumed run reuses the briefs it already paid a model to
   * write, instead of planning the same shots twice.
   */
  readonly visualPrompts?: readonly VisualPromptDto[];
  /**
   * Narration blocks as stored in the `narration_plan` JSON column.
   *
   * Persisted because the audio and the subtitles are both rendered from it: a
   * resumed run must produce a `.srt` that matches the `.mp3` an earlier
   * process already generated.
   */
  readonly narrationBlocks?: readonly NarrationBlockDto[];
}

/** Persisted authored content for one topic. */
export interface ContentDto {
  readonly id: string;
  readonly topicId: string;
  readonly title: string;
  readonly hook: string | null;
  readonly script: string;
  readonly caption: string | null;
  readonly hashtags: readonly string[];
  readonly thumbnailPrompt: string | null;
  readonly scenes: readonly SceneDto[] | null;
  readonly visualPrompts: readonly VisualPromptDto[] | null;
  readonly narrationBlocks: readonly NarrationBlockDto[] | null;
  readonly language: string;
  readonly targetDurationSeconds: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
