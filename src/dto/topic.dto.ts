import type { TopicStatus } from '../types/topic.js';

/** Input for the Topic Agent. */
export interface TopicRequestDto {
  /** Identity of the run, carried into every log record the agent emits. */
  readonly correlationId: string;
  /** Thematic area, e.g. `"personal finance"`. */
  readonly category: string;
  readonly language: string;
  /** Who the video is for, e.g. `"first-time investors"`. */
  readonly audience: string;
  /** Spoken length the topic has to fit into. */
  readonly durationSeconds: number;
}

/** A topic proposal that has not yet passed duplicate detection. */
export interface TopicCandidateDto {
  readonly title: string;
  readonly description: string | null;
}

/** Input accepted by `TopicRepository.create`. */
export interface NewTopicDto extends TopicCandidateDto {
  /** Lowercased, whitespace-collapsed title used for exact-match lookup. */
  readonly normalizedTitle: string;
  readonly language: string;
  readonly category: string | null;
  readonly audience: string | null;
  readonly status: TopicStatus;
}

/** A persisted, unique topic. */
export interface TopicDto extends TopicCandidateDto {
  readonly id: string;
  readonly normalizedTitle: string;
  readonly language: string;
  readonly category: string | null;
  readonly audience: string | null;
  readonly status: TopicStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
