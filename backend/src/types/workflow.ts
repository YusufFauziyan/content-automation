/**
 * Domain vocabulary of the content pipeline.
 *
 * These enums are intentionally independent from the Prisma-generated enums:
 * the domain must not depend on the database driver. `src/database/enum.map.ts`
 * translates between the two, and that mapping is the only place aware of both.
 */

/** Coarse-grained recovery checkpoint of a workflow run. */
export enum WorkflowStatus {
  Pending = 'PENDING',
  TopicCreated = 'TOPIC_CREATED',
  ScriptCreated = 'SCRIPT_CREATED',
  SceneCreated = 'SCENE_CREATED',
  ImagesCreated = 'IMAGES_CREATED',
  VoiceCreated = 'VOICE_CREATED',
  SubtitleCreated = 'SUBTITLE_CREATED',
  VideoCreated = 'VIDEO_CREATED',
  UploadCompleted = 'UPLOAD_COMPLETED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
}

/** A single retryable unit of work inside a run. */
export enum WorkflowStepName {
  Topic = 'TOPIC',
  Script = 'SCRIPT',
  Scene = 'SCENE',
  /** Turns the shot list into one fully specified image brief per scene. */
  VisualPlan = 'VISUAL_PLAN',
  Image = 'IMAGE',
  /** Splits the script into timed narration blocks. */
  NarrationPlan = 'NARRATION_PLAN',
  Voice = 'VOICE',
  Subtitle = 'SUBTITLE',
  /** Turns everything produced so far into an explicit render timeline. */
  RenderPlan = 'RENDER_PLAN',
  Compose = 'COMPOSE',
  QualityCheck = 'QUALITY_CHECK',
  Upload = 'UPLOAD',
  Cleanup = 'CLEANUP',
}

/** Execution state of a single step. */
export enum WorkflowStepStatus {
  Pending = 'PENDING',
  Running = 'RUNNING',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Skipped = 'SKIPPED',
}

/**
 * Execution order of the pipeline.
 *
 * The workflow resumes at the first step whose recorded status is not
 * `SUCCEEDED`, which is what makes a crashed run recoverable instead of
 * restartable (ARCHITECTURE.md "Workflow State").
 *
 * IMAGE and VOICE are listed sequentially here but are independent after scene
 * planning; the workflow executes them concurrently (PROJECT_RULES.md
 * "Performance").
 */
export const PIPELINE_STEPS: readonly WorkflowStepName[] = [
  WorkflowStepName.Topic,
  WorkflowStepName.Script,
  WorkflowStepName.Scene,
  WorkflowStepName.VisualPlan,
  WorkflowStepName.Image,
  WorkflowStepName.NarrationPlan,
  WorkflowStepName.Voice,
  WorkflowStepName.Subtitle,
  WorkflowStepName.RenderPlan,
  WorkflowStepName.Compose,
  WorkflowStepName.QualityCheck,
  WorkflowStepName.Upload,
  WorkflowStepName.Cleanup,
] as const;

/**
 * Steps the workflow can actually execute today, in pipeline order.
 *
 * Everything after these is declared in {@link PIPELINE_STEPS} but reports
 * `NOT_IMPLEMENTED`. Adding a step here is part of implementing it: the entry
 * is what makes the step selectable as `PIPELINE_LAST_STEP`, and what lets
 * startup reject a request to run something that does not exist yet.
 */
export const IMPLEMENTED_PIPELINE_STEPS: readonly WorkflowStepName[] = [
  WorkflowStepName.Topic,
  WorkflowStepName.Script,
  WorkflowStepName.Scene,
  WorkflowStepName.VisualPlan,
  WorkflowStepName.Image,
  WorkflowStepName.NarrationPlan,
  WorkflowStepName.Voice,
  WorkflowStepName.Subtitle,
  WorkflowStepName.RenderPlan,
  WorkflowStepName.Compose,
  WorkflowStepName.Upload,
] as const;

/** How far the pipeline runs unless configuration says otherwise. */
export const DEFAULT_PIPELINE_LAST_STEP: WorkflowStepName =
  IMPLEMENTED_PIPELINE_STEPS[IMPLEMENTED_PIPELINE_STEPS.length - 1] ?? WorkflowStepName.Topic;

/** Checkpoint written once the given step succeeds. */
export const CHECKPOINT_AFTER_STEP: Readonly<Record<WorkflowStepName, WorkflowStatus>> = {
  [WorkflowStepName.Topic]: WorkflowStatus.TopicCreated,
  [WorkflowStepName.Script]: WorkflowStatus.ScriptCreated,
  [WorkflowStepName.Scene]: WorkflowStatus.SceneCreated,
  // Planning the images does not move the coarse checkpoint: nothing has been
  // produced yet that a resumed run could reuse beyond the scene plan. The
  // step's own row is what records that the planning is done.
  [WorkflowStepName.VisualPlan]: WorkflowStatus.SceneCreated,
  [WorkflowStepName.Image]: WorkflowStatus.ImagesCreated,
  // Planning the narration produces no artefact of its own, so the coarse
  // checkpoint does not move; the step's own row records that it is done.
  [WorkflowStepName.NarrationPlan]: WorkflowStatus.ImagesCreated,
  [WorkflowStepName.Voice]: WorkflowStatus.VoiceCreated,
  [WorkflowStepName.Subtitle]: WorkflowStatus.SubtitleCreated,
  // Building the timeline produces no artefact of its own; the step's own row
  // records that it is done.
  [WorkflowStepName.RenderPlan]: WorkflowStatus.SubtitleCreated,
  [WorkflowStepName.Compose]: WorkflowStatus.VideoCreated,
  [WorkflowStepName.QualityCheck]: WorkflowStatus.VideoCreated,
  [WorkflowStepName.Upload]: WorkflowStatus.UploadCompleted,
  [WorkflowStepName.Cleanup]: WorkflowStatus.Completed,
};
