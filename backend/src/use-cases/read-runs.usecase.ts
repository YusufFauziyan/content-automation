import type { ContentRepository } from '../repositories/content.repository.js';
import type { ImageRepository } from '../repositories/image.repository.js';
import type { LogRepository } from '../repositories/log.repository.js';
import type { TopicRepository } from '../repositories/topic.repository.js';
import type { UploadRepository } from '../repositories/upload.repository.js';
import type { VideoRepository } from '../repositories/video.repository.js';
import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import type { Logger } from '../types/logger.js';
import { RecordNotFoundError } from '../types/errors/persistence.error.js';
import { PIPELINE_STEPS, WorkflowStepStatus, type WorkflowStepName } from '../types/workflow.js';

/** One run, as a list needs it. */
export interface RunSummaryView {
  readonly id: string;
  readonly correlationId: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** Step the run stopped on, or null when nothing has failed. */
  readonly failedStep: WorkflowStepName | null;
}

export interface StepView {
  readonly step: WorkflowStepName;
  readonly status: WorkflowStepStatus;
  readonly attempt: number;
  readonly durationMs: number | null;
  readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } | null;
}

/**
 * A planned scene together with whatever image currently stands in for it.
 *
 * The brief travels with the scene on purpose: when generation fails, the brief
 * is the only thing that lets a person produce the missing still themselves.
 */
export interface SceneView {
  readonly scene: number;
  readonly prompt: string;
  readonly caption: string;
  readonly durationSeconds: number;
  readonly status: 'ok' | 'failed';
  /** Path relative to the media root, e.g. `workflows/{id}/images/scene-001.jpg`. */
  readonly imagePath: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly byteSize: number | null;
  /** Combo that produced it, or `manual` when a person supplied it. */
  readonly source: string | null;
  /** Camera move the renderer applies over the still. */
  readonly camera: string;
  /** How this scene gives way to the next. */
  readonly transition: string;
  /** Visual treatment the planner asked for. */
  readonly style: string;
}

export interface RunView extends RunSummaryView {
  readonly steps: readonly StepView[];
  readonly scenes: readonly SceneView[];
  readonly video: {
    readonly path: string;
    readonly durationMs: number;
    readonly width: number;
    readonly height: number;
    readonly byteSize: number;
  } | null;
  /**
   * Where the video was published, once it was.
   *
   * The render is deleted after a verified upload, so this is what a run has
   * left to show for itself months later — worth carrying with the run rather
   * than making a reader go and look for it.
   */
  readonly uploads: readonly {
    readonly platform: string;
    readonly status: string;
    readonly externalUrl: string | null;
    readonly uploadedAt: string | null;
    readonly verifiedAt: string | null;
  }[];
  readonly logs: readonly {
    readonly at: string;
    readonly level: string;
    readonly source: string;
    readonly message: string;
  }[];
}

/** One log record, as a reader needs it. */
export interface LogView {
  readonly at: string;
  readonly level: string;
  readonly source: string;
  readonly message: string;
  readonly correlationId: string | null;
  readonly step: string | null;
}

const MAX_LOG_LINES = 300;

/**
 * Reads a run and everything hanging off it.
 *
 * Assembly lives here rather than in the controller because deciding what a
 * "run" means — which steps exist, how a scene without an image is reported —
 * is a rule about the domain, not about HTTP. A second delivery mechanism gets
 * the same answer for free.
 */
export class ReadRunsUseCase {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly contentRepository: ContentRepository,
    private readonly imageRepository: ImageRepository,
    private readonly videoRepository: VideoRepository,
    private readonly uploadRepository: UploadRepository,
    private readonly logRepository: LogRepository,
    private readonly topicRepository: TopicRepository,
    private readonly logger: Logger,
  ) {}

  /** Most recent runs first. */
  public async list(limit: number): Promise<readonly RunSummaryView[]> {
    const runs = await this.workflowRepository.findRecentRuns(limit);

    return Promise.all(
      runs.map(async (run) => {
        const steps = await this.workflowRepository.findSteps(run.id);
        return this.toSummary(run, steps, await this.titleFor(run));
      }),
    );
  }

  /**
   * @throws {RecordNotFoundError} When no run carries that id.
   */
  public async detail(runId: string): Promise<RunView> {
    const run = await this.workflowRepository.findRunById(runId);

    if (run === null) {
      throw new RecordNotFoundError('WorkflowRun', runId);
    }

    const steps = await this.workflowRepository.findSteps(run.id);
    const content = run.contentId === null ? null : await this.contentRepository.findById(run.contentId);
    const images = run.contentId === null ? [] : await this.imageRepository.findByContentId(run.contentId);
    const videos = run.contentId === null ? [] : await this.videoRepository.findByContentId(run.contentId);
    // Every destination, not just the first: a run can go to TikTok and
    // YouTube, and showing one of them is how the other goes unnoticed.
    const uploads =
      run.contentId === null ? [] : await this.uploadRepository.findByContentId(run.contentId);
    const logs = await this.logRepository.findByCorrelationId(run.correlationId, MAX_LOG_LINES);

    const byScene = new Map(images.map((image) => [image.sceneNumber, image]));
    const scenes: SceneView[] = (content?.scenes ?? []).map((scene) => {
      const image = byScene.get(scene.scene);

      return {
        scene: scene.scene,
        prompt: content?.visualPrompts?.find((p) => p.scene === scene.scene)?.prompt ?? scene.imagePrompt,
        caption: scene.narration,
        durationSeconds: scene.duration,
        status: image === undefined ? 'failed' : 'ok',
        imagePath: image?.relativePath ?? null,
        width: image?.width ?? null,
        height: image?.height ?? null,
        byteSize: image?.byteSize ?? null,
        source: image?.combo ?? null,
        camera: scene.camera,
        transition: scene.transition,
        style: scene.style,
      };
    });

    const video = videos[0];

    this.logger.debug('Run read', {
      source: ReadRunsUseCase.name,
      workflowRunId: run.id,
      sceneCount: scenes.length,
      imageCount: images.length,
    });

    return {
      ...this.toSummary(run, steps, await this.titleFor(run)),
      steps: PIPELINE_STEPS.map((step) => this.toStepView(step, steps)),
      scenes,
      video:
        video === undefined
          ? null
          : {
              path: video.relativePath,
              durationMs: video.durationMs,
              width: video.width,
              height: video.height,
              byteSize: video.byteSize,
            },
      uploads: uploads.map((upload) => ({
        platform: upload.platform,
        status: upload.status,
        externalUrl: upload.externalUrl,
        uploadedAt: upload.uploadedAt?.toISOString() ?? null,
        verifiedAt: upload.verifiedAt?.toISOString() ?? null,
      })),
      logs: logs.map((entry) => ({
        at: entry.createdAt.toISOString(),
        level: entry.level,
        source: entry.source ?? 'workflow',
        message: entry.message,
      })),
    };
  }

  /** The newest log records across every run, for an operations view. */
  public async recentLogs(limit: number): Promise<readonly LogView[]> {
    const entries = await this.logRepository.findRecent(limit);

    return entries.map((entry) => ({
      at: entry.createdAt.toISOString(),
      level: entry.level,
      source: entry.source ?? 'workflow',
      message: entry.message,
      correlationId: entry.correlationId,
      step: entry.step ?? null,
    }));
  }

  private toStepView(
    step: WorkflowStepName,
    recorded: readonly { step: WorkflowStepName; status: WorkflowStepStatus; attempt: number; durationMs: number | null; lastError: unknown }[],
  ): StepView {
    const found = recorded.find((r) => r.step === step);

    if (found === undefined) {
      return { step, status: WorkflowStepStatus.Pending, attempt: 0, durationMs: null, error: null };
    }

    const error = found.lastError as { code?: string; message?: string; retryable?: boolean } | null;

    return {
      step,
      status: found.status,
      attempt: found.attempt,
      durationMs: found.durationMs,
      error:
        error === null
          ? null
          : {
              code: error.code ?? 'UNKNOWN',
              message: error.message ?? 'No message recorded.',
              retryable: error.retryable ?? false,
            },
    };
  }

  private toSummary(
    run: {
      id: string;
      correlationId: string;
      status: string;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
    },
    steps: readonly { step: WorkflowStepName; status: WorkflowStepStatus }[],
    title: string,
  ): RunSummaryView {
    return {
      id: run.id,
      correlationId: run.correlationId,
      title,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      failedStep: steps.find((s) => s.status === WorkflowStepStatus.Failed)?.step ?? null,
    };
  }

  /**
   * What to call a run.
   *
   * The script's headline once there is one — it is written to be read. Before
   * the script step finishes there is no content row yet, so the topic stands
   * in: a run started from a typed subject should show that subject, not
   * "Untitled run", which tells nobody which run they are looking at.
   */
  private async titleFor(run: { contentId: string | null; topicId: string | null }): Promise<string> {
    if (run.contentId !== null) {
      const content = await this.contentRepository.findById(run.contentId);
      if (content !== null) return content.title;
    }

    if (run.topicId !== null) {
      const topic = await this.topicRepository.findById(run.topicId);
      if (topic !== null) return topic.title;
    }

    return 'Untitled run';
  }
}
