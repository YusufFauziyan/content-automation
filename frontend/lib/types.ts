/**
 * Shapes the UI reads.
 *
 * These mirror the backend DTOs (`backend/src/dto`) and the workflow step names
 * in `backend/src/types/workflow.ts`. They are declared here rather than
 * imported so the frontend can build and run on its own; when the backend grows
 * an HTTP layer, this file is the contract to check against.
 */

/**
 * Pipeline steps, in execution order. Mirrors `PIPELINE_STEPS`.
 *
 * Mirrors it exactly, name for name. It once said `THUMBNAIL` where the backend
 * says `QUALITY_CHECK`, and the cost was a diagram with a line running into an
 * empty space: the card could not be drawn for a step no run contains, but the
 * edge to it was drawn anyway.
 */
export const STEPS = [
  'TOPIC',
  'SCRIPT',
  'SCENE',
  'VISUAL_PLAN',
  'IMAGE',
  'NARRATION_PLAN',
  'VOICE',
  'SUBTITLE',
  'RENDER_PLAN',
  'COMPOSE',
  'QUALITY_CHECK',
  'UPLOAD',
  'CLEANUP',
] as const;

export type StepName = (typeof STEPS)[number];

/** Mirrors `WorkflowStepStatus`. */
export type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

/** Mirrors `WorkflowStatus`. */
export type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type NodeCategory = 'trigger' | 'ai' | 'media' | 'video' | 'upload' | 'logic';

/** A typed error as the backend reports it — code, message, retryable. */
export interface StepError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface StepRun {
  readonly step: StepName;
  status: StepStatus;
  attempt: number;
  durationMs: number | null;
  error: StepError | null;
}

/**
 * One planned scene: the brief that was written for it, and whatever image
 * currently stands in for it.
 *
 * `source` is what makes manual recovery auditable — an image that a person
 * uploaded must never be indistinguishable from one the router produced.
 */
export interface Scene {
  readonly scene: number;
  /** The visual brief, verbatim as sent to the image provider. */
  readonly prompt: string;
  /** Narration line this scene sits under, for context while choosing a still. */
  readonly caption: string;
  readonly durationSeconds: number;
  status: 'ok' | 'failed' | 'pending' | 'uploading';
  /** URL the browser can load, or null when there is no image yet. */
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  /** Which provider produced it, or `manual` when a person supplied it. */
  source: string | null;
  /** Camera move the renderer applies over the still. */
  camera: string;
  /** How this scene gives way to the next. */
  transition: string;
  /** Visual treatment the planner asked for. */
  style: string;
  error: StepError | null;
}

export interface VideoResult {
  readonly url: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  /** Subtitle timeline length, so drift is visible without opening a player. */
  readonly subtitleDurationMs: number;
  readonly audioDurationMs: number;
  readonly cueCount: number;
}

export interface LogLine {
  readonly at: string;
  readonly level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  readonly source: string;
  readonly message: string;
}

/** The narration track, when one has been produced. */
export interface AudioTrack {
  readonly url: string;
  readonly byteSize: number;
}

/** The burned-in captions, with their text so they can be read in place. */
export interface SubtitleTrack {
  readonly url: string;
  readonly byteSize: number;
  readonly cues: readonly { readonly index: number; readonly time: string; readonly text: string }[];
}

export interface Run {
  readonly id: string;
  title: string;
  status: RunStatus;
  readonly createdAt: string;
  steps: StepRun[];
  scenes: Scene[];
  video: VideoResult | null;
  audio: AudioTrack | null;
  subtitle: SubtitleTrack | null;
  /**
   * Where the video was published, one entry per destination.
   *
   * The render is deleted after a verified upload, so these outlive the file
   * and are the only thing a finished run has left to point at.
   */
  uploads: UploadResult[];
  logs: LogLine[];
  /** Step the run stopped on, when it failed. */
  failedStep: StepName | null;
}

/** One publish attempt attached to a run — one per destination. */
export interface UploadResult {
  readonly platform: string;
  readonly status: string;
  readonly externalUrl: string | null;
  readonly uploadedAt: string | null;
  readonly verifiedAt: string | null;
}

export interface RunSummary {
  readonly id: string;
  readonly title: string;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly failedStep: StepName | null;
}

/** Presentation metadata per step. The canvas reads this, nothing else. */
export interface StepMeta {
  readonly step: StepName;
  readonly title: string;
  readonly subtitle: string;
  readonly category: NodeCategory;
  readonly icon: string;
}

export const STEP_META: Record<StepName, StepMeta> = {
  TOPIC: { step: 'TOPIC', title: 'Topic Generation', subtitle: 'TopicAgent · deduped by embedding', category: 'ai', icon: 'sparkles' },
  SCRIPT: { step: 'SCRIPT', title: 'Script Generation', subtitle: 'ScriptAgent · hook + body', category: 'ai', icon: 'file-text' },
  SCENE: { step: 'SCENE', title: 'Scene Planning', subtitle: 'SceneAgent · shot list', category: 'ai', icon: 'layers' },
  VISUAL_PLAN: { step: 'VISUAL_PLAN', title: 'Visual Planning', subtitle: 'VisualPlannerAgent · image briefs', category: 'ai', icon: 'palette' },
  IMAGE: { step: 'IMAGE', title: 'Image Generation', subtitle: '9 Router · one still per scene', category: 'media', icon: 'image' },
  NARRATION_PLAN: { step: 'NARRATION_PLAN', title: 'Narration Planning', subtitle: 'Blocks, pauses, emphasis', category: 'ai', icon: 'list' },
  VOICE: { step: 'VOICE', title: 'Narration Generation', subtitle: '9 Router · measured per block', category: 'media', icon: 'mic' },
  SUBTITLE: { step: 'SUBTITLE', title: 'Subtitle Generation', subtitle: 'From the measured plan', category: 'media', icon: 'captions' },
  RENDER_PLAN: { step: 'RENDER_PLAN', title: 'Timeline Builder', subtitle: 'Scenes, camera, transitions', category: 'logic', icon: 'git-branch' },
  COMPOSE: { step: 'COMPOSE', title: 'Video Rendering', subtitle: 'FFmpeg · 1080×1920 · 30fps', category: 'video', icon: 'film' },
  QUALITY_CHECK: { step: 'QUALITY_CHECK', title: 'Quality Check', subtitle: 'Not built yet · skipped', category: 'logic', icon: 'star' },
  UPLOAD: { step: 'UPLOAD', title: 'Social Upload', subtitle: 'TikTok · YouTube · publish and verify', category: 'upload', icon: 'upload' },
  CLEANUP: { step: 'CLEANUP', title: 'Cleanup', subtitle: 'Delete media, keep metadata', category: 'logic', icon: 'trash' },
};

export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  trigger: 'var(--node-trigger)',
  ai: 'var(--node-ai)',
  media: 'var(--node-media)',
  video: 'var(--node-video)',
  upload: 'var(--node-upload)',
  logic: 'var(--node-logic)',
};
