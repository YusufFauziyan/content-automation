import type {
  LogLevel as DbLogLevel,
  TopicStatus as DbTopicStatus,
  UploadPlatform as DbUploadPlatform,
  UploadStatus as DbUploadStatus,
  WorkflowStatus as DbWorkflowStatus,
  WorkflowStepName as DbWorkflowStepName,
  WorkflowStepStatus as DbWorkflowStepStatus,
} from './generated/enums.js';
import { LogLevel } from '../types/logger.js';
import { TopicStatus } from '../types/topic.js';
import { UploadPlatform, UploadStatus } from '../types/upload.js';
import { WorkflowStatus, WorkflowStepName, WorkflowStepStatus } from '../types/workflow.js';

/**
 * Translation between the domain enums and the Prisma-generated enums.
 *
 * The two happen to share their string values today, but the domain must not
 * inherit that coincidence: renaming a column value in a migration must break
 * exactly one file — this one — and nothing else.
 */

/** Builds the database-to-domain direction from the domain-to-database map. */
const invert = <TDomain extends string, TDb extends string>(
  map: Readonly<Record<TDomain, TDb>>,
): Readonly<Record<TDb, TDomain>> =>
  Object.fromEntries(
    Object.entries<TDb>(map).map(([domain, database]) => [database, domain]),
  ) as Record<TDb, TDomain>;

// --- Topic ------------------------------------------------------------------

const TOPIC_STATUS_TO_DB: Readonly<Record<TopicStatus, DbTopicStatus>> = {
  [TopicStatus.Candidate]: 'CANDIDATE',
  [TopicStatus.Accepted]: 'ACCEPTED',
  [TopicStatus.RejectedDuplicate]: 'REJECTED_DUPLICATE',
  [TopicStatus.Archived]: 'ARCHIVED',
};
const TOPIC_STATUS_FROM_DB = invert(TOPIC_STATUS_TO_DB);

export const toDbTopicStatus = (value: TopicStatus): DbTopicStatus => TOPIC_STATUS_TO_DB[value];
export const toTopicStatus = (value: DbTopicStatus): TopicStatus => TOPIC_STATUS_FROM_DB[value];

// --- Workflow ---------------------------------------------------------------

const WORKFLOW_STATUS_TO_DB: Readonly<Record<WorkflowStatus, DbWorkflowStatus>> = {
  [WorkflowStatus.Pending]: 'PENDING',
  [WorkflowStatus.TopicCreated]: 'TOPIC_CREATED',
  [WorkflowStatus.ScriptCreated]: 'SCRIPT_CREATED',
  [WorkflowStatus.SceneCreated]: 'SCENE_CREATED',
  [WorkflowStatus.ImagesCreated]: 'IMAGES_CREATED',
  [WorkflowStatus.VoiceCreated]: 'VOICE_CREATED',
  [WorkflowStatus.SubtitleCreated]: 'SUBTITLE_CREATED',
  [WorkflowStatus.VideoCreated]: 'VIDEO_CREATED',
  [WorkflowStatus.UploadCompleted]: 'UPLOAD_COMPLETED',
  [WorkflowStatus.Completed]: 'COMPLETED',
  [WorkflowStatus.Failed]: 'FAILED',
};
const WORKFLOW_STATUS_FROM_DB = invert(WORKFLOW_STATUS_TO_DB);

export const toDbWorkflowStatus = (value: WorkflowStatus): DbWorkflowStatus =>
  WORKFLOW_STATUS_TO_DB[value];
export const toWorkflowStatus = (value: DbWorkflowStatus): WorkflowStatus =>
  WORKFLOW_STATUS_FROM_DB[value];

const WORKFLOW_STEP_NAME_TO_DB: Readonly<Record<WorkflowStepName, DbWorkflowStepName>> = {
  [WorkflowStepName.Topic]: 'TOPIC',
  [WorkflowStepName.Script]: 'SCRIPT',
  [WorkflowStepName.Scene]: 'SCENE',
  [WorkflowStepName.VisualPlan]: 'VISUAL_PLAN',
  [WorkflowStepName.Image]: 'IMAGE',
  [WorkflowStepName.NarrationPlan]: 'NARRATION_PLAN',
  [WorkflowStepName.Voice]: 'VOICE',
  [WorkflowStepName.Subtitle]: 'SUBTITLE',
  [WorkflowStepName.RenderPlan]: 'RENDER_PLAN',
  [WorkflowStepName.Compose]: 'COMPOSE',
  [WorkflowStepName.QualityCheck]: 'QUALITY_CHECK',
  [WorkflowStepName.Upload]: 'UPLOAD',
  [WorkflowStepName.Cleanup]: 'CLEANUP',
};
const WORKFLOW_STEP_NAME_FROM_DB = invert(WORKFLOW_STEP_NAME_TO_DB);

export const toDbWorkflowStepName = (value: WorkflowStepName): DbWorkflowStepName =>
  WORKFLOW_STEP_NAME_TO_DB[value];
export const toWorkflowStepName = (value: DbWorkflowStepName): WorkflowStepName =>
  WORKFLOW_STEP_NAME_FROM_DB[value];

const WORKFLOW_STEP_STATUS_TO_DB: Readonly<Record<WorkflowStepStatus, DbWorkflowStepStatus>> = {
  [WorkflowStepStatus.Pending]: 'PENDING',
  [WorkflowStepStatus.Running]: 'RUNNING',
  [WorkflowStepStatus.Succeeded]: 'SUCCEEDED',
  [WorkflowStepStatus.Failed]: 'FAILED',
  [WorkflowStepStatus.Skipped]: 'SKIPPED',
};
const WORKFLOW_STEP_STATUS_FROM_DB = invert(WORKFLOW_STEP_STATUS_TO_DB);

export const toDbWorkflowStepStatus = (value: WorkflowStepStatus): DbWorkflowStepStatus =>
  WORKFLOW_STEP_STATUS_TO_DB[value];
export const toWorkflowStepStatus = (value: DbWorkflowStepStatus): WorkflowStepStatus =>
  WORKFLOW_STEP_STATUS_FROM_DB[value];

// --- Upload -----------------------------------------------------------------

const UPLOAD_PLATFORM_TO_DB: Readonly<Record<UploadPlatform, DbUploadPlatform>> = {
  [UploadPlatform.TikTok]: 'TIKTOK',
  [UploadPlatform.YouTube]: 'YOUTUBE',
};
const UPLOAD_PLATFORM_FROM_DB = invert(UPLOAD_PLATFORM_TO_DB);

export const toDbUploadPlatform = (value: UploadPlatform): DbUploadPlatform =>
  UPLOAD_PLATFORM_TO_DB[value];
export const toUploadPlatform = (value: DbUploadPlatform): UploadPlatform =>
  UPLOAD_PLATFORM_FROM_DB[value];

const UPLOAD_STATUS_TO_DB: Readonly<Record<UploadStatus, DbUploadStatus>> = {
  [UploadStatus.Pending]: 'PENDING',
  [UploadStatus.Uploading]: 'UPLOADING',
  [UploadStatus.Uploaded]: 'UPLOADED',
  [UploadStatus.Verified]: 'VERIFIED',
  [UploadStatus.Failed]: 'FAILED',
};
const UPLOAD_STATUS_FROM_DB = invert(UPLOAD_STATUS_TO_DB);

export const toDbUploadStatus = (value: UploadStatus): DbUploadStatus => UPLOAD_STATUS_TO_DB[value];
export const toUploadStatus = (value: DbUploadStatus): UploadStatus => UPLOAD_STATUS_FROM_DB[value];

// --- Logging ----------------------------------------------------------------

const LOG_LEVEL_TO_DB: Readonly<Record<LogLevel, DbLogLevel>> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
};
const LOG_LEVEL_FROM_DB = invert(LOG_LEVEL_TO_DB);

export const toDbLogLevel = (value: LogLevel): DbLogLevel => LOG_LEVEL_TO_DB[value];
export const toLogLevel = (value: DbLogLevel): LogLevel => LOG_LEVEL_FROM_DB[value];
