import type { ContentDto } from '../dto/content.dto.js';
import type { ImageGenerationRequestDto, ImageGenerationResponseDto } from '../dto/image.dto.js';
import type { NarrationPlanDto, NarrationPlanRequestDto } from '../dto/narration.dto.js';
import type { RenderPlanDto, RenderPlanRequestDto } from '../dto/render-plan.dto.js';
import type { ScenePlanDto, ScenePlanRequestDto } from '../dto/scene.dto.js';
import type { SubtitleGenerationResponseDto, SubtitleRequestDto } from '../dto/subtitle.dto.js';
import type { ScriptDto, ScriptRequestDto } from '../dto/script.dto.js';
import type { TopicDto, TopicRequestDto } from '../dto/topic.dto.js';
import type { VideoRenderRequestDto, VideoRenderResponseDto } from '../dto/video.dto.js';
import type { VoiceGenerationResponseDto, VoiceRequestDto } from '../dto/voice.dto.js';
import type { VisualPlanDto, VisualPlanRequestDto } from '../dto/visual-prompt.dto.js';
import type {
  GenerateContentRequestDto,
  GenerateContentResponseDto,
  WorkflowContextDto,
} from '../dto/workflow-context.dto.js';
import type { WorkflowRunDto, WorkflowStepRunDto } from '../dto/workflow.dto.js';
import { join } from 'node:path';

import type { MediaConfig } from '../config/app.config.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import type { ImageRepository } from '../repositories/image.repository.js';
import type { TopicRepository } from '../repositories/topic.repository.js';
import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import type { Agent } from '../types/agent.js';
import { isApplicationError } from '../types/errors/application.error.js';
import { NotImplementedError } from '../types/errors/not-implemented.error.js';
import { RecordNotFoundError } from '../types/errors/persistence.error.js';
import { WorkflowStepError } from '../types/errors/workflow.error.js';
import type { Logger } from '../types/logger.js';
import { COVER_FILE_NAME } from '../agents/ffmpeg-composer.agent.js';
import { TO_CREDENTIAL } from '../agents/upload.agent.js';
import { CredentialAuthMethod } from '../dto/credential.dto.js';
import type { UploadDto, UploadRequestDto } from '../dto/upload.dto.js';
import type { AudioRepository } from '../repositories/audio.repository.js';
import type { CredentialRepository } from '../repositories/credential.repository.js';
import type { VideoRepository } from '../repositories/video.repository.js';
import type { ApplicationError } from '../types/errors/application.error.js';
import { fail, ok, type Result } from '../types/result.js';
import { UploadPlatform } from '../types/upload.js';
import {
  CHECKPOINT_AFTER_STEP,
  IMPLEMENTED_PIPELINE_STEPS,
  PIPELINE_STEPS,
  WorkflowStatus,
  WorkflowStepName,
  WorkflowStepStatus,
} from '../types/workflow.js';
import { createCorrelationId } from '../utils/identity/correlation-id.js';
import type { RetryExecutor } from '../utils/retry/retry-executor.js';

/** The audio metadata is stored in milliseconds; the DTO speaks seconds. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The request a publish-only pass restores state with.
 *
 * None of it is used to make anything: restoring reads the database, and the
 * only field it consults is the duration a stored script fell back to. Named
 * rather than passed in so no caller mistakes it for a choice that matters.
 */
const PUBLISH_ONLY: GenerateContentRequestDto = {
  category: 'technology',
  language: 'en',
  audience: 'general',
  durationSeconds: 45,
  visualStyle: 'cinematic',
  aspectRatio: '9:16',
};

/** Everything the steps of one run hand to each other. */
interface PipelineState {
  topic: TopicDto | null;
  script: ScriptDto | null;
  scenePlan: ScenePlanDto | null;
  visualPlan: VisualPlanDto | null;
  images: ImageGenerationResponseDto | null;
  narrationPlan: NarrationPlanDto | null;
  voice: VoiceGenerationResponseDto | null;
  subtitle: SubtitleGenerationResponseDto | null;
  renderPlan: RenderPlanDto | null;
  video: VideoRenderResponseDto | null;
  upload: UploadDto | null;
}

/**
 * Steps that still have to run, in pipeline order.
 *
 * A resumed run repeats nothing that already succeeded — this is the whole
 * point of recording steps individually (ARCHITECTURE.md "Workflow State").
 * Exported as a pure function so the resume rule can be unit tested without a
 * database.
 *
 * @param recordedSteps What the run has already attempted.
 * @param stopAfterStep Last step to plan for; omit to plan the whole pipeline.
 */
/**
 * Steps that are re-run on a resume even after they succeeded.
 *
 * Both are pure recomputation over state the run already holds — no model, no
 * network, no cost beyond a few milliseconds — and neither leaves a record a
 * resumed run could restore them from. Skipping them left the pipeline holding
 * a null where the next step expected their output, which surfaced as
 * "the render step requires a render plan" on every resumed run.
 *
 * Anything expensive stays skipped. This list is for work that is cheaper to
 * repeat than to persist.
 */
const ALWAYS_RECOMPUTED: readonly WorkflowStepName[] = [
  WorkflowStepName.Subtitle,
  WorkflowStepName.RenderPlan,
];

export const resolvePendingSteps = (
  recordedSteps: readonly WorkflowStepRunDto[],
  stopAfterStep?: WorkflowStepName,
): readonly WorkflowStepName[] => {
  const succeeded = new Set(
    recordedSteps
      .filter((step) => step.status === WorkflowStepStatus.Succeeded)
      .map((step) => step.step),
  );

  for (const step of ALWAYS_RECOMPUTED) succeeded.delete(step);

  const lastIndex =
    stopAfterStep === undefined ? PIPELINE_STEPS.length - 1 : PIPELINE_STEPS.indexOf(stopAfterStep);

  return (
    PIPELINE_STEPS.slice(0, lastIndex + 1)
      .filter((step) => !succeeded.has(step))
      // A stage declared but not built is stepped over rather than attempted.
      // `QUALITY_CHECK` sits between compose and upload; without this, asking
      // the pipeline to publish would fail on a stage nobody has written yet,
      // and the stage after it would never run.
      .filter((step) => IMPLEMENTED_PIPELINE_STEPS.includes(step))
  );
};

/**
 * Rebuilds the script DTO from its persisted row.
 *
 * A resumed run must continue with the same script the previous process wrote,
 * and the database is the only place that survived the crash.
 */
const toScriptDto = (content: ContentDto, fallbackDurationSeconds: number): ScriptDto => ({
  contentId: content.id,
  topicId: content.topicId,
  title: content.title,
  hook: content.hook ?? '',
  script: content.script,
  caption: content.caption ?? '',
  hashtags: content.hashtags,
  thumbnailPrompt: content.thumbnailPrompt ?? '',
  language: content.language,
  durationSeconds: content.targetDurationSeconds ?? fallbackDurationSeconds,
});

/**
 * Orchestrates one end-to-end content run.
 *
 * The workflow owns execution order, retries, resume and workflow state, and
 * nothing else. It makes no content decisions: every one of those belongs to
 * the agent it dispatches to. It never talks to an external system directly.
 *
 * Steps beyond image generation are declared in `PIPELINE_STEPS` but report
 * `NOT_IMPLEMENTED`, so the shape of the pipeline is visible long before all of
 * it exists.
 */
export class GenerateContentWorkflow {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly topicRepository: TopicRepository,
    private readonly contentRepository: ContentRepository,
    private readonly imageRepository: ImageRepository,
    private readonly audioRepository: AudioRepository,
    private readonly mediaConfig: MediaConfig,
    private readonly topicAgent: Agent<TopicRequestDto, TopicDto>,
    private readonly scriptAgent: Agent<ScriptRequestDto, ScriptDto>,
    private readonly sceneAgent: Agent<ScenePlanRequestDto, ScenePlanDto>,
    private readonly visualPlannerAgent: Agent<VisualPlanRequestDto, VisualPlanDto>,
    private readonly imageAgent: Agent<ImageGenerationRequestDto, ImageGenerationResponseDto>,
    private readonly narrationPlannerAgent: Agent<NarrationPlanRequestDto, NarrationPlanDto>,
    private readonly voiceAgent: Agent<VoiceRequestDto, VoiceGenerationResponseDto>,
    private readonly subtitleAgent: Agent<SubtitleRequestDto, SubtitleGenerationResponseDto>,
    private readonly timelineBuilderAgent: Agent<RenderPlanRequestDto, RenderPlanDto>,
    private readonly composerAgent: Agent<VideoRenderRequestDto, VideoRenderResponseDto>,
    /** Null when this installation has no way to publish. */
    private readonly uploadAgent: Agent<UploadRequestDto, UploadDto> | null,
    private readonly credentialRepository: CredentialRepository,
    private readonly videoRepository: VideoRepository,
    private readonly retryExecutor: RetryExecutor,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs, or resumes, the content pipeline.
   *
   * @param request What to generate, how far to go, and which run to continue.
   * @returns Everything the run produced, or the failure that stopped it.
   */
  public async execute(
    request: GenerateContentRequestDto,
  ): Promise<Result<GenerateContentResponseDto>> {
    try {
      return await this.runPipeline(request);
    } catch (error) {
      if (isApplicationError(error)) {
        this.logger.error('Workflow aborted', error, { source: GenerateContentWorkflow.name });
        return fail(error);
      }
      throw error;
    }
  }

  /**
   * Publishes an existing run's video again, to some or all destinations.
   *
   * Separate from {@link execute} because it answers a different question. A
   * resume asks "what has this run not done yet"; this asks "send that video
   * there, now" — which is what somebody wants after a publish was interrupted,
   * or after one platform failed and the other did not.
   *
   * Everything before COMPOSE is left alone. The video already exists; nothing
   * here re-renders it.
   *
   * @param platforms Destinations to publish to, or every connected one.
   */
  public async publish(
    workflowRunId: string,
    platforms?: readonly UploadPlatform[],
  ): Promise<Result<void>> {
    const run = await this.workflowRepository.findRunById(workflowRunId);

    if (run === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Upload, `No run ${workflowRunId} to publish.`),
      );
    }

    const logger = this.logger.child({
      correlationId: run.correlationId,
      workflowRunId: run.id,
      source: GenerateContentWorkflow.name,
    });
    const state = await this.restoreState(run, {
      ...PUBLISH_ONLY,
      resumeCorrelationId: run.correlationId,
    });

    if (state.video === null) {
      return fail(
        new WorkflowStepError(
          WorkflowStepName.Upload,
          'This run has no rendered video to publish. Resume it first.',
        ),
      );
    }

    const context: WorkflowContextDto = {
      workflowRunId: run.id,
      correlationId: run.correlationId,
    };

    logger.info('Publishing on request', { platforms: platforms ?? 'all connected' });

    return this.runStep(
      WorkflowStepName.Upload,
      context,
      state,
      { ...PUBLISH_ONLY, resumeCorrelationId: run.correlationId },
      logger,
      platforms,
    );
  }

  private async runPipeline(
    request: GenerateContentRequestDto,
  ): Promise<Result<GenerateContentResponseDto>> {
    const run = await this.resolveRun(request);
    const logger = this.logger.child({
      correlationId: run.correlationId,
      workflowRunId: run.id,
      source: GenerateContentWorkflow.name,
    });

    const recordedSteps = await this.workflowRepository.findSteps(run.id);
    const pendingSteps = resolvePendingSteps(recordedSteps, request.stopAfterStep);
    const state = await this.restoreState(run, request);

    logger.info('Workflow started', {
      resumed: recordedSteps.length > 0,
      pendingSteps: pendingSteps.length,
      stopAfterStep: request.stopAfterStep ?? null,
    });

    await this.workflowRepository.updateRun(run.id, { startedAt: new Date() });

    const context: WorkflowContextDto = {
      workflowRunId: run.id,
      correlationId: run.correlationId,
    };

    let status = run.status;

    for (const step of pendingSteps) {
      const skipped = await this.skipReason(step);

      if (skipped !== null) {
        await this.workflowRepository.recordStep(context.workflowRunId, step, {
          status: WorkflowStepStatus.Skipped,
          finishedAt: new Date(),
          lastError: null,
        });
        logger.child({ step }).info('SKIPPED', { reason: skipped });

        status = CHECKPOINT_AFTER_STEP[step];
        await this.workflowRepository.updateRun(context.workflowRunId, { status });
        continue;
      }

      const outcome = await this.runStep(step, context, state, request, logger);

      if (!outcome.success) {
        await this.workflowRepository.updateRun(context.workflowRunId, {
          status: WorkflowStatus.Failed,
          finishedAt: new Date(),
          lastError: outcome.error.toJSON(),
        });
        return fail(outcome.error);
      }

      status = CHECKPOINT_AFTER_STEP[step];
      await this.workflowRepository.updateRun(context.workflowRunId, { status });
    }

    // A run that walked the whole pipeline is COMPLETED; one that stopped at a
    // requested step keeps that step's checkpoint but is still finished, so the
    // recovery sweep leaves it alone.
    const completed = request.stopAfterStep === undefined;
    const finalStatus = completed ? WorkflowStatus.Completed : status;

    await this.workflowRepository.updateRun(context.workflowRunId, {
      status: finalStatus,
      finishedAt: new Date(),
      lastError: null,
    });

    logger.info('Workflow finished', { status: finalStatus });

    return ok({
      workflowRunId: context.workflowRunId,
      correlationId: run.correlationId,
      status: finalStatus,
      topic: state.topic,
      script: state.script,
      scenePlan: state.scenePlan,
      visualPlan: state.visualPlan,
      images: state.images,
      narrationPlan: state.narrationPlan,
      voice: state.voice,
      subtitle: state.subtitle,
      renderPlan: state.renderPlan,
      video: state.video,
      uploadUrl: state.upload?.externalUrl ?? null,
    });
  }

  /**
   * Executes one step under the retry policy and records its outcome.
   *
   * The step row is written before and after the attempt, so a process that
   * dies mid-step leaves a `RUNNING` row that the next run treats as pending.
   */
  private async runStep(
    step: WorkflowStepName,
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
    logger: Logger,
    onlyPlatforms?: readonly UploadPlatform[],
  ): Promise<Result<void>> {
    const stepLogger = logger.child({ step });
    const startedAt = new Date();

    await this.workflowRepository.recordStep(context.workflowRunId, step, {
      status: WorkflowStepStatus.Running,
      startedAt,
      lastError: null,
    });
    stepLogger.info('START');

    let attempts = 0;
    const result = await this.retryExecutor.execute(
      step,
      (attempt) => {
        attempts = attempt;
        return this.executeStep(step, context, state, request, onlyPlatforms);
      },
      { correlationId: context.correlationId, workflowRunId: context.workflowRunId, step },
    );

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    if (result.success) {
      await this.workflowRepository.recordStep(context.workflowRunId, step, {
        status: WorkflowStepStatus.Succeeded,
        attempt: attempts,
        durationMs,
        finishedAt,
        lastError: null,
      });
      stepLogger.info('SUCCESS', { durationMs, retryCount: attempts - 1 });

      return ok(undefined);
    }

    await this.workflowRepository.recordStep(context.workflowRunId, step, {
      status: WorkflowStepStatus.Failed,
      attempt: attempts,
      durationMs,
      finishedAt,
      lastError: result.error.toJSON(),
    });
    stepLogger.error('FAILED', result.error, { durationMs, retryCount: attempts - 1 });

    return fail(
      new WorkflowStepError(step, `Workflow step ${step} failed.`, {
        cause: result.error.toJSON(),
      }),
    );
  }

  /**
   * Dispatches a single step to its agent and threads the result forward.
   *
   * This is the only place the workflow knows agents exist, which is what keeps
   * the orchestration above it independent of how the pipeline grows.
   */
  private async executeStep(
    step: WorkflowStepName,
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
    onlyPlatforms?: readonly UploadPlatform[],
  ): Promise<Result<void>> {
    switch (step) {
      case WorkflowStepName.Topic:
        return this.runTopicStep(context, state, request);
      case WorkflowStepName.Script:
        return this.runScriptStep(context, state, request);
      case WorkflowStepName.Scene:
        return this.runSceneStep(context, state, request);
      case WorkflowStepName.VisualPlan:
        return this.runVisualPlanStep(context, state, request);
      case WorkflowStepName.Image:
        return this.runImageStep(context, state);
      case WorkflowStepName.NarrationPlan:
        return this.runNarrationPlanStep(context, state, request);
      case WorkflowStepName.Voice:
        return this.runVoiceStep(context, state, request);
      case WorkflowStepName.Subtitle:
        return this.runSubtitleStep(context, state);
      case WorkflowStepName.RenderPlan:
        return this.runRenderPlanStep(context, state);
      case WorkflowStepName.Compose:
        return this.runComposeStep(context, state);
      case WorkflowStepName.Upload:
        return this.runUploadStep(context, state, onlyPlatforms);
      default:
        return fail(new NotImplementedError(`Workflow step ${step}`));
    }
  }

  private async runTopicStep(
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
  ): Promise<Result<void>> {
    const result = await this.topicAgent.execute({
      correlationId: context.correlationId,
      category: request.category,
      language: request.language,
      audience: request.audience,
      durationSeconds: request.durationSeconds,
      ...(request.requestedTitle === undefined ? {} : { requestedTitle: request.requestedTitle }),
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.topic = result.data;
    await this.workflowRepository.updateRun(context.workflowRunId, { topicId: result.data.id });

    return ok(undefined);
  }

  private async runScriptStep(
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
  ): Promise<Result<void>> {
    if (state.topic === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Script, 'The script step requires a topic.'),
      );
    }

    const result = await this.scriptAgent.execute({
      correlationId: context.correlationId,
      topic: state.topic,
      durationSeconds: request.durationSeconds,
      audience: request.audience,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.script = result.data;
    await this.workflowRepository.updateRun(context.workflowRunId, {
      contentId: result.data.contentId,
    });

    return ok(undefined);
  }

  private async runSceneStep(
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
  ): Promise<Result<void>> {
    if (state.script === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Scene, 'The scene step requires a script.'),
      );
    }

    const result = await this.sceneAgent.execute({
      correlationId: context.correlationId,
      script: state.script,
      durationSeconds: request.durationSeconds,
      visualStyle: request.visualStyle,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.scenePlan = result.data;

    return ok(undefined);
  }

  private async runVisualPlanStep(
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
  ): Promise<Result<void>> {
    if (state.scenePlan === null) {
      return fail(
        new WorkflowStepError(
          WorkflowStepName.VisualPlan,
          'The visual planning step requires a scene plan.',
        ),
      );
    }

    const result = await this.visualPlannerAgent.execute({
      correlationId: context.correlationId,
      workflowId: context.workflowRunId,
      scenePlan: state.scenePlan,
      visualStyle: request.visualStyle,
      aspectRatio: request.aspectRatio,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.visualPlan = result.data;

    return ok(undefined);
  }

  private async runImageStep(
    context: WorkflowContextDto,
    state: PipelineState,
  ): Promise<Result<void>> {
    if (state.visualPlan === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Image, 'The image step requires a visual plan.'),
      );
    }

    const result = await this.imageAgent.execute({
      correlationId: context.correlationId,
      workflowId: context.workflowRunId,
      contentId: state.visualPlan.contentId,
      prompts: state.visualPlan.prompts,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.images = result.data;

    return ok(undefined);
  }

  private async runNarrationPlanStep(
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
  ): Promise<Result<void>> {
    if (state.script === null) {
      return fail(
        new WorkflowStepError(
          WorkflowStepName.NarrationPlan,
          'The narration planning step requires a script.',
        ),
      );
    }

    const result = await this.narrationPlannerAgent.execute({
      correlationId: context.correlationId,
      script: state.script,
      durationSeconds: request.durationSeconds,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.narrationPlan = result.data;

    return ok(undefined);
  }

  private async runVoiceStep(
    context: WorkflowContextDto,
    state: PipelineState,
    request: GenerateContentRequestDto,
  ): Promise<Result<void>> {
    if (state.narrationPlan === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Voice, 'The voice step requires a narration plan.'),
      );
    }

    const result = await this.voiceAgent.execute({
      correlationId: context.correlationId,
      workflowId: context.workflowRunId,
      contentId: state.narrationPlan.contentId,
      plan: state.narrationPlan,
      language: request.language,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.voice = result.data;
    // The Voice Agent measured every block it spoke. From here on the measured
    // plan is the one that counts — the subtitles are timed against it.
    state.narrationPlan = result.data.plan;

    return ok(undefined);
  }

  private async runSubtitleStep(
    context: WorkflowContextDto,
    state: PipelineState,
  ): Promise<Result<void>> {
    if (state.narrationPlan === null) {
      return fail(
        new WorkflowStepError(
          WorkflowStepName.Subtitle,
          'The subtitle step requires a narration plan.',
        ),
      );
    }

    const result = await this.subtitleAgent.execute({
      correlationId: context.correlationId,
      workflowId: context.workflowRunId,
      contentId: state.narrationPlan.contentId,
      plan: state.narrationPlan,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.subtitle = result.data;

    return ok(undefined);
  }

  private async runRenderPlanStep(
    context: WorkflowContextDto,
    state: PipelineState,
  ): Promise<Result<void>> {
    if (
      state.scenePlan === null ||
      state.images === null ||
      state.narrationPlan === null ||
      state.voice === null ||
      state.subtitle === null
    ) {
      return fail(
        new WorkflowStepError(
          WorkflowStepName.RenderPlan,
          'The render plan needs the scenes, images, narration, audio and subtitles.',
        ),
      );
    }

    const result = await this.timelineBuilderAgent.execute({
      correlationId: context.correlationId,
      workflowId: context.workflowRunId,
      contentId: state.narrationPlan.contentId,
      scenePlan: state.scenePlan,
      images: state.images.images,
      narrationPlan: state.narrationPlan,
      voice: state.voice,
      subtitle: state.subtitle,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.renderPlan = result.data;

    return ok(undefined);
  }

  private async runComposeStep(
    context: WorkflowContextDto,
    state: PipelineState,
  ): Promise<Result<void>> {
    if (state.renderPlan === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Compose, 'The render step requires a render plan.'),
      );
    }

    const result = await this.composerAgent.execute({
      correlationId: context.correlationId,
      workflowId: context.workflowRunId,
      contentId: state.renderPlan.contentId,
      plan: state.renderPlan,
    });

    if (!result.success) {
      return fail(result.error);
    }

    state.video = result.data;

    return ok(undefined);
  }

  /**
   * Publishes the finished video to the connected account.
   *
   * Reached only when {@link skipReason} found an enabled account, so the
   * absence of one is not handled here: by this point publishing is meant to
   * happen, and anything that stops it is a failure worth reporting.
   */
  private async runUploadStep(
    context: WorkflowContextDto,
    state: PipelineState,
    only?: readonly UploadPlatform[],
  ): Promise<Result<void>> {
    if (state.video === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Upload, 'The upload step requires a rendered video.'),
      );
    }
    if (this.uploadAgent === null) {
      return fail(
        new WorkflowStepError(WorkflowStepName.Upload, 'Publishing is not configured.'),
      );
    }

    const connected = await this.connectedPlatforms();
    // A narrowing, not a bypass: a platform asked for by name still has to have
    // an enabled account, or there is nothing to publish as.
    const targets = only === undefined ? connected : connected.filter((p) => only.includes(p));

    if (targets.length === 0) {
      return fail(
        new WorkflowStepError(
          WorkflowStepName.Upload,
          only === undefined
            ? 'No enabled account is connected to publish to.'
            : `No enabled account is connected for ${only.join(', ')}.`,
        ),
      );
    }

    const video = state.video.video;
    const title = state.script?.title ?? state.topic?.title ?? '';
    // The script's own caption is a written paragraph and the hook is its first
    // spoken line. Both were sitting unused while YouTube's description got the
    // title over again.
    const description = [state.script?.caption, state.script?.hook]
      .filter((part): part is string => part !== undefined && part.trim() !== '')
      .join('\n\n');
    const hashtags = state.script?.hashtags ?? [];

    // Published one destination at a time, and one failing does not stop the
    // others: a YouTube session that expired is no reason for TikTok to miss
    // the video. The step fails only if nowhere took it.
    const failures: ApplicationError[] = [];

    for (const platform of targets) {
      const result = await this.uploadAgent.execute({
        contentId: state.video.contentId,
        platform,
        video,
        title,
        description: description === '' ? title : description,
        hashtags,
      });

      if (result.success) {
        state.upload = result.data;
      } else {
        failures.push(result.error);
      }
    }

    return failures.length === targets.length && failures[0] !== undefined
      ? fail(failures[0])
      : ok(undefined);
  }

  /** Destinations with an enabled browser account, in a stable order. */
  private async connectedPlatforms(): Promise<readonly UploadPlatform[]> {
    const targets: UploadPlatform[] = [];

    for (const platform of Object.values(UploadPlatform)) {
      const account = await this.credentialRepository.findUsable(
        TO_CREDENTIAL[platform],
        CredentialAuthMethod.Browser,
      );

      if (account !== null) targets.push(platform);
    }

    return targets;
  }

  /**
   * Why a step should be stepped over, or null when it should run.
   *
   * Skipping is not failing. A run with nowhere to publish has still produced
   * everything it was asked for, and marking it failed would turn a working
   * pipeline into a red dashboard for a reason nobody chose.
   */
  private async skipReason(step: WorkflowStepName): Promise<string | null> {
    if (step !== WorkflowStepName.Upload) return null;

    if (this.uploadAgent === null) {
      return 'Publishing is switched off — no upload URL is configured.';
    }

    const targets = await this.connectedPlatforms();

    return targets.length === 0 ? 'No enabled account is connected to publish to.' : null;
  }

  /**
   * Reloads what a previous process already produced.
   *
   * Without this a resumed run would skip the topic step — because it
   * succeeded — and then fail the script step for want of a topic.
   */
  private async restoreState(
    run: WorkflowRunDto,
    request: GenerateContentRequestDto,
  ): Promise<PipelineState> {
    const state: PipelineState = {
      topic: null,
      script: null,
      scenePlan: null,
      visualPlan: null,
      images: null,
      narrationPlan: null,
      voice: null,
      subtitle: null,
      renderPlan: null,
      video: null,
      upload: null,
    };

    if (run.topicId !== null) {
      state.topic = await this.topicRepository.findById(run.topicId);
    }

    if (run.contentId === null) {
      return state;
    }

    const content = await this.contentRepository.findById(run.contentId);

    if (content === null) {
      return state;
    }

    state.script = toScriptDto(content, request.durationSeconds);

    if (content.scenes !== null) {
      state.scenePlan = {
        contentId: content.id,
        scenes: content.scenes,
        totalDurationSeconds: content.scenes.reduce((total, scene) => total + scene.duration, 0),
      };
    }

    if (content.visualPrompts !== null) {
      state.visualPlan = { contentId: content.id, prompts: content.visualPrompts };
    }

    // Restored, unlike the files themselves: a run that resumes past a
    // successful image step still has to hand the renderer a list of stills,
    // and `scene_images` is the record of what that step produced. Without
    // this the render plan fails on every resumed run.
    const images = await this.imageRepository.findByContentId(content.id);

    if (images.length > 0) {
      state.images = {
        contentId: content.id,
        workflowId: run.id,
        imagesDirectory: join(this.mediaConfig.outputDirectory, 'workflows', run.id, 'images'),
        images: images.map((image) => ({
          scene: image.sceneNumber,
          fileName: image.fileName,
          relativePath: image.relativePath,
          absolutePath: join(
            this.mediaConfig.outputDirectory,
            'workflows',
            run.id,
            image.relativePath,
          ),
          byteSize: image.byteSize,
          mimeType: image.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
          width: image.width,
          height: image.height,
          generationDurationMs: image.generationDurationMs,
          combo: image.combo,
        })),
        totalDurationMs: images.reduce((total, image) => total + image.generationDurationMs, 0),
      };
    }

    // Restored for the same reason the stills are: the upload step needs a
    // file to hand the browser, and a resumed run skips compose because it
    // already succeeded. The bytes are still on disk; only the DTO was lost.
    const [rendered] = await this.videoRepository.findByContentId(content.id);

    if (rendered !== undefined) {
      state.video = {
        contentId: content.id,
        workflowId: run.id,
        videoDirectory: join(this.mediaConfig.outputDirectory, 'workflows', run.id, 'video'),
        video: {
          fileName: rendered.fileName,
          relativePath: rendered.relativePath,
          absolutePath: join(
            this.mediaConfig.outputDirectory,
            'workflows',
            run.id,
            rendered.relativePath,
          ),
          byteSize: rendered.byteSize,
          width: rendered.width,
          height: rendered.height,
          fps: rendered.fps,
          durationMs: rendered.durationMs,
          videoCodec: rendered.videoCodec,
          audioCodec: rendered.audioCodec,
          renderDurationMs: rendered.renderDurationMs,
          // Not recorded in `rendered_videos`, and nothing after compose reads
          // it — the uploader wants a path and a size. Restored as false rather
          // than guessed, so it is never mistaken for a fact from the database.
          hasBackgroundMusic: false,
          // Found the same deterministic way the video is: a fixed name in the
          // run's own folder. Whether the file is still there is the
          // publisher's problem, and it treats a missing cover as no cover.
          coverPath: join(
            this.mediaConfig.outputDirectory,
            'workflows',
            run.id,
            'video',
            COVER_FILE_NAME,
          ),
        },
      };
    }

    if (content.narrationBlocks !== null) {
      state.narrationPlan = {
        contentId: content.id,
        blocks: content.narrationBlocks,
        totalDurationSeconds:
          Math.round(
            content.narrationBlocks.reduce(
              (total, block) => total + block.estimatedDuration + block.pauseAfter,
              0,
            ) * 10,
          ) / 10,
      };
    }

    // Restored for the same reason the stills are, and it is the reason a
    // resumed run used to stop at the timeline builder: VOICE is skipped
    // because it succeeded, so nothing put the narration back, and the render
    // plan refused for want of audio it had already produced.
    const [narration] = await this.audioRepository.findByContentId(content.id);

    if (narration !== undefined && state.narrationPlan !== null) {
      state.voice = {
        contentId: content.id,
        workflowId: run.id,
        audioDirectory: join(this.mediaConfig.outputDirectory, 'workflows', run.id, 'audio'),
        audio: {
          fileName: narration.fileName,
          relativePath: narration.relativePath,
          absolutePath: join(
            this.mediaConfig.outputDirectory,
            'workflows',
            run.id,
            narration.relativePath,
          ),
          byteSize: narration.byteSize,
          mimeType: narration.mimeType,
          durationSeconds: narration.durationMs / MILLISECONDS_PER_SECOND,
          voice: narration.voice,
          model: narration.model,
          speed: narration.speed,
          generationDurationMs: narration.generationDurationMs,
        },
        // The measured plan, not the planner's estimate: the voice agent wrote
        // its measurements back to the content, and everything timed against
        // the narration has to use those or it drifts.
        plan: state.narrationPlan,
      };
    }

    return state;
  }

  /** Creates a new run, or loads the one being resumed. */
  private async resolveRun(request: GenerateContentRequestDto): Promise<WorkflowRunDto> {
    if (request.resumeCorrelationId === undefined) {
      return this.workflowRepository.createRun({ correlationId: createCorrelationId() });
    }

    const existing = await this.workflowRepository.findRunByCorrelationId(
      request.resumeCorrelationId,
    );

    if (existing === null) {
      throw new RecordNotFoundError('WorkflowRun', request.resumeCorrelationId);
    }

    return existing;
  }
}
