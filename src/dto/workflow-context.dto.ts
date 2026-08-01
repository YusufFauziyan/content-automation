import type { ImageGenerationResponseDto } from './image.dto.js';
import type { NarrationPlanDto } from './narration.dto.js';
import type { ScenePlanDto } from './scene.dto.js';
import type { RenderPlanDto } from './render-plan.dto.js';
import type { SubtitleGenerationResponseDto } from './subtitle.dto.js';
import type { ScriptDto } from './script.dto.js';
import type { TopicDto } from './topic.dto.js';
import type { VisualPlanDto } from './visual-prompt.dto.js';
import type { VideoRenderResponseDto } from './video.dto.js';
import type { VoiceGenerationResponseDto } from './voice.dto.js';
import type { WorkflowStatus, WorkflowStepName } from '../types/workflow.js';

/**
 * Identity of a single pipeline execution.
 *
 * Created by the workflow, threaded through every step, and attached to every
 * log line so a crashed run can be reconstructed end to end.
 */
export interface WorkflowContextDto {
  /**
   * Also the workspace name: `output/workflows/{workflowRunId}`. The path
   * itself is owned by `WorkingDirectoryService` and never built here.
   */
  readonly workflowRunId: string;
  readonly correlationId: string;
}

/** Input for the content pipeline. */
export interface GenerateContentRequestDto {
  /** Thematic area the topic is drawn from. */
  readonly category: string;
  readonly language: string;
  /** Who the video is for. */
  readonly audience: string;
  /** Spoken length the script and the scene plan are built for. */
  readonly durationSeconds: number;
  /** Visual treatment requested from the Scene and Visual Planner agents. */
  readonly visualStyle: string;
  /** Aspect ratio every generated still is framed for, e.g. `"9:16"`. */
  readonly aspectRatio: string;
  /**
   * Stop once this step has succeeded.
   *
   * This is what lets "generate only a topic" be a first-class operation
   * without a second workflow: the pipeline is one sequence, and a use-case
   * chooses how far along it to travel.
   */
  readonly stopAfterStep?: WorkflowStepName;
  /**
   * Correlation id of an interrupted run to resume. When omitted a new run is
   * started (ARCHITECTURE.md "Workflow State").
   */
  readonly resumeCorrelationId?: string;
}

/**
 * What a caller asks for, without saying how far the pipeline should go.
 *
 * Each use-case supplies `stopAfterStep` itself — that choice is the use-case's
 * identity, not the caller's.
 */
export type PipelineRequestDto = Omit<GenerateContentRequestDto, 'stopAfterStep'>;

/** Everything one run produced. */
export interface GenerateContentResponseDto {
  readonly workflowRunId: string;
  readonly correlationId: string;
  readonly status: WorkflowStatus;
  readonly topic: TopicDto | null;
  readonly script: ScriptDto | null;
  readonly scenePlan: ScenePlanDto | null;
  readonly visualPlan: VisualPlanDto | null;
  readonly images: ImageGenerationResponseDto | null;
  readonly narrationPlan: NarrationPlanDto | null;
  readonly voice: VoiceGenerationResponseDto | null;
  readonly subtitle: SubtitleGenerationResponseDto | null;
  readonly renderPlan: RenderPlanDto | null;
  readonly video: VideoRenderResponseDto | null;
  /** Populated once publishing is implemented. */
  readonly uploadUrl: string | null;
}
