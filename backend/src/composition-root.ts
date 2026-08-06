import { FfmpegComposerAgent } from './agents/ffmpeg-composer.agent.js';
import { ImageAgent } from './agents/image.agent.js';
import { NarrationPlannerAgent } from './agents/narration-planner.agent.js';
import { SceneAgent } from './agents/scene.agent.js';
import { ScriptAgent } from './agents/script.agent.js';
import { SubtitleAgent } from './agents/subtitle.agent.js';
import { TimelineBuilderAgent } from './agents/timeline-builder.agent.js';
import { TopicAgent } from './agents/topic.agent.js';
import { VisualPlannerAgent } from './agents/visual-planner.agent.js';
import { VoiceAgent } from './agents/voice.agent.js';
import type { AppConfig } from './config/app.config.js';
import { CliController } from './controllers/cli.controller.js';
import { createDatabase, type Database } from './database/prisma.client.js';
import { ContentRepository } from './repositories/content.repository.js';
import { EmbeddingRepository } from './repositories/embedding.repository.js';
import { ImageRepository } from './repositories/image.repository.js';
import { VideoRepository } from './repositories/video.repository.js';
import { LogRepository } from './repositories/log.repository.js';
import { AudioRepository } from './repositories/audio.repository.js';
import { CredentialRepository } from './repositories/credential.repository.js';
import { ScheduleRepository } from './repositories/schedule.repository.js';
import { TopicRepository } from './repositories/topic.repository.js';
import { UploadRepository } from './repositories/upload.repository.js';
import { WorkflowRepository } from './repositories/workflow.repository.js';
import { ProcessFfmpegService, type FfmpegService } from './services/ffmpeg.service.js';
import { HttpController } from './controllers/http.controller.js';
import { ROUTER_SPEECH_SPEED, RouterSpeechService } from './services/router-speech.service.js';
import type { SpeechService } from './services/speech.service.js';
import { AesSecretBox } from './services/secret-box.service.js';
import { HttpNineRouterService, type NineRouterService } from './services/nine-router.service.js';
import { FilePromptLoader, type PromptLoader } from './services/prompt-loader.service.js';
import { SrtSubtitleService, type SubtitleService } from './services/subtitle.service.js';
import {
  LocalWorkingDirectoryService,
  type WorkingDirectoryService,
} from './services/working-directory.service.js';
import type { Logger } from './types/logger.js';
import { GenerateContentUseCase } from './use-cases/generate-content.usecase.js';
import { GenerateImageUseCase } from './use-cases/generate-image.usecase.js';
import { GenerateSceneUseCase } from './use-cases/generate-scene.usecase.js';
import { GenerateScriptUseCase } from './use-cases/generate-script.usecase.js';
import { GenerateTopicUseCase } from './use-cases/generate-topic.usecase.js';
import { GenerateVoiceUseCase } from './use-cases/generate-voice.usecase.js';
import { RenderVideoUseCase } from './use-cases/render-video.usecase.js';
import { DeleteRunsUseCase } from './use-cases/delete-runs.usecase.js';
import { ReadRunsUseCase } from './use-cases/read-runs.usecase.js';
import { ReconcileRunsUseCase } from './use-cases/reconcile-runs.usecase.js';
import { ResumeInterruptedUseCase } from './use-cases/resume-interrupted.usecase.js';
import { CredentialPlatform } from './dto/credential.dto.js';
import { UploadPlatform } from './types/upload.js';
import { CaptureSessionUseCase } from './use-cases/capture-session.usecase.js';
import { ManageUploadsUseCase } from './use-cases/manage-uploads.usecase.js';
import { ReadUploadsUseCase } from './use-cases/read-uploads.usecase.js';
import { PublishRunUseCase } from './use-cases/publish-run.usecase.js';
import { SettleStepUseCase } from './use-cases/settle-step.usecase.js';
import { ManageCredentialsUseCase } from './use-cases/manage-credentials.usecase.js';
import { ManageSchedulesUseCase } from './use-cases/manage-schedules.usecase.js';
import { RunSchedulesUseCase } from './use-cases/run-schedules.usecase.js';
import { SuggestTopicsUseCase } from './use-cases/suggest-topics.usecase.js';
import { SuggestTopicsWorkflow } from './workflows/suggest-topics.workflow.js';
import { TopicIdeasAgent } from './agents/topic-ideas.agent.js';
import { BrowserUploadAgent, type UploadAgent } from './agents/upload.agent.js';
import {
  PlaywrightPublishService,
  type PlaywrightService,
} from './services/playwright.service.js';
import { YouTubePublishService } from './services/youtube.service.js';
import { ResumeRunUseCase } from './use-cases/resume-run.usecase.js';
import { PersistentLogger } from './utils/logger/persistent.logger.js';
import { StructuredLogger } from './utils/logger/structured.logger.js';
import { RetryExecutor } from './utils/retry/retry-executor.js';
import { GenerateContentWorkflow } from './workflows/generate-content.workflow.js';
import { RetryWorkflow } from './workflows/retry.workflow.js';

/** Every repository, exposed so later agents can be wired without re-reading this file. */
export interface Repositories {
  readonly topic: TopicRepository;
  readonly content: ContentRepository;
  readonly workflow: WorkflowRepository;
  readonly upload: UploadRepository;
  readonly embedding: EmbeddingRepository;
  readonly image: ImageRepository;
  readonly video: VideoRepository;
  readonly log: LogRepository;
  readonly schedule: ScheduleRepository;
  readonly credential: CredentialRepository;
  readonly audio: AudioRepository;
}

/** Every external-system adapter that exists today. */
export interface Services {
  readonly nineRouter: NineRouterService;
  readonly speech: SpeechService;
  readonly ffmpeg: FfmpegService;
  readonly promptLoader: PromptLoader;
  readonly subtitle: SubtitleService;
  readonly workingDirectory: WorkingDirectoryService;
  /** Null when this installation does not publish to TikTok through a browser. */
  readonly playwright: PlaywrightService | null;
  /** Null when this installation does not publish to YouTube through a browser. */
  readonly youtube: PlaywrightService | null;
}

/** The assembled application. */
export interface Application {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: Database;
  readonly repositories: Repositories;
  readonly services: Services;
  readonly controller: CliController;
  /** Serves the editor. Same use-cases as the CLI, a different way in. */
  readonly httpController: HttpController;
  /** Settles runs a previous process left mid-flight. Run once at startup. */
  readonly reconcileRunsUseCase: ReconcileRunsUseCase;
  /** Started on a timer by `serve`; makes the videos that are due. */
  readonly runSchedulesUseCase: RunSchedulesUseCase;
  /**
   * Publishes a finished video, or null when no browser is configured.
   *
   * Built but not yet part of the pipeline: `PIPELINE_LAST_STEP` still stops at
   * compose, and adding an upload step is its own change. Constructing it here
   * means that change is a wiring edit rather than a new dependency graph.
   */
  readonly uploadAgent: UploadAgent | null;
  /** Releases the connection pool. Always awaited before the process exits. */
  shutdown(): Promise<void>;
}

/**
 * The composition root: the single place allowed to call `new`.
 *
 * Every class in this project receives its collaborators through its
 * constructor, which is what makes each of them testable in isolation. That
 * only works if exactly one place decides which implementations are used — this
 * function. A `new` anywhere else re-introduces the coupling the constructors
 * were designed to avoid.
 *
 * Construction is deliberately explicit rather than reflective: with a few
 * dozen classes, a container library would add a decorator layer and a runtime
 * dependency to solve a problem this file solves in one screen, and it would
 * move wiring errors from compile time to startup.
 *
 * @param config Configuration already validated by `loadConfig`.
 */
export const createApplication = (config: AppConfig): Application => {
  // --- Infrastructure -------------------------------------------------------
  const database = createDatabase(config.database);

  const repositories: Repositories = {
    topic: new TopicRepository(database),
    content: new ContentRepository(database),
    workflow: new WorkflowRepository(database),
    upload: new UploadRepository(database),
    embedding: new EmbeddingRepository(database),
    image: new ImageRepository(database),
    video: new VideoRepository(database),
    log: new LogRepository(database),
    schedule: new ScheduleRepository(database),
    credential: new CredentialRepository(database),
    audio: new AudioRepository(database),
  };

  // --- Cross-cutting concerns ----------------------------------------------
  const consoleLogger = new StructuredLogger(config.logging.level);
  const persistentLogger = config.logging.persist
    ? new PersistentLogger(consoleLogger, repositories.log, config.logging.level)
    : null;
  const logger: Logger = persistentLogger ?? consoleLogger;

  const retryExecutor = new RetryExecutor(config.workflow, logger);
  // One box, two callers: the use case seals what an operator types, the upload
  // agent opens it. A second instance would be a second chance to derive the
  // key differently.
  const secretBox = new AesSecretBox(config.credentials);

  // --- Services -------------------------------------------------------------
  const services: Services = {
    nineRouter: new HttpNineRouterService(config.nineRouter, logger),
    // The router speaks every language the pipeline offers, one voice each.
    speech: new RouterSpeechService(config.routerSpeech, logger),
    ffmpeg: new ProcessFfmpegService(config.video, logger),
    promptLoader: new FilePromptLoader(config.media),
    subtitle: new SrtSubtitleService(),
    workingDirectory: new LocalWorkingDirectoryService(config.media),
    playwright:
      config.tiktokBrowser === null
        ? null
        : new PlaywrightPublishService(config.tiktokBrowser, logger),
    youtube:
      config.youtubeBrowser === null
        ? null
        : new YouTubePublishService(config.youtubeBrowser, logger),
  };

  // --- Agents ---------------------------------------------------------------
  // The embedding service is not built yet, so the Topic Agent receives `null`
  // and rejects duplicates on exact title alone. Wiring the adapter here is the
  // only change the semantic stage will need.
  const topicAgent = new TopicAgent(
    services.nineRouter,
    services.promptLoader,
    repositories.topic,
    repositories.embedding,
    null,
    config.content,
    logger,
  );
  const scriptAgent = new ScriptAgent(
    services.nineRouter,
    services.promptLoader,
    repositories.content,
    logger,
  );
  const sceneAgent = new SceneAgent(
    services.nineRouter,
    services.promptLoader,
    repositories.content,
    logger,
  );
  const visualPlannerAgent = new VisualPlannerAgent(
    services.nineRouter,
    services.promptLoader,
    repositories.content,
    services.workingDirectory,
    config.image,
    logger,
  );
  const imageAgent = new ImageAgent(
    services.nineRouter,
    services.workingDirectory,
    repositories.image,
    config.image,
    logger,
  );
  const narrationPlannerAgent = new NarrationPlannerAgent(
    services.nineRouter,
    services.promptLoader,
    repositories.content,
    config.narration,
    ROUTER_SPEECH_SPEED,
    logger,
  );
  const voiceAgent = new VoiceAgent(
    services.speech,
    services.ffmpeg,
    services.workingDirectory,
    repositories.content,
    repositories.audio,
    logger,
  );
  const subtitleAgent = new SubtitleAgent(services.subtitle, services.workingDirectory, logger);
  const timelineBuilderAgent = new TimelineBuilderAgent(
    config.video,
    config.backgroundMusic,
    logger,
  );
  const composerAgent = new FfmpegComposerAgent(
    services.ffmpeg,
    services.workingDirectory,
    repositories.video,
    config.video,
    logger,
  );

  // One publisher per destination that is configured. An empty map means
  // nothing can publish, which the workflow reads as "skip", not "fail".
  const publishers = {
    ...(services.playwright === null ? {} : { [UploadPlatform.TikTok]: services.playwright }),
    ...(services.youtube === null ? {} : { [UploadPlatform.YouTube]: services.youtube }),
  };
  const uploadAgent: UploadAgent | null =
    Object.keys(publishers).length === 0
      ? null
      : new BrowserUploadAgent(
          publishers,
          repositories.credential,
          repositories.upload,
          secretBox,
          logger,
        );

  // --- Workflows ------------------------------------------------------------
  const generateContentWorkflow = new GenerateContentWorkflow(
    repositories.workflow,
    repositories.topic,
    repositories.content,
    repositories.image,
    repositories.audio,
    config.media,
    topicAgent,
    scriptAgent,
    sceneAgent,
    visualPlannerAgent,
    imageAgent,
    narrationPlannerAgent,
    voiceAgent,
    subtitleAgent,
    timelineBuilderAgent,
    composerAgent,
    uploadAgent,
    repositories.credential,
    repositories.video,
    retryExecutor,
    logger,
  );
  const retryWorkflow = new RetryWorkflow(
    repositories.workflow,
    generateContentWorkflow,
    config.pipeline,
    logger,
  );

  // --- Use cases ------------------------------------------------------------
  const generateContentUseCase = new GenerateContentUseCase(
    generateContentWorkflow,
    config.pipeline,
    logger,
  );
  const generateTopicUseCase = new GenerateTopicUseCase(generateContentWorkflow, logger);
  const generateScriptUseCase = new GenerateScriptUseCase(generateContentWorkflow, logger);
  const generateSceneUseCase = new GenerateSceneUseCase(generateContentWorkflow, logger);
  const generateImageUseCase = new GenerateImageUseCase(generateContentWorkflow, logger);
  const generateVoiceUseCase = new GenerateVoiceUseCase(generateContentWorkflow, logger);
  const renderVideoUseCase = new RenderVideoUseCase(generateContentWorkflow, logger);
  const resumeInterruptedUseCase = new ResumeInterruptedUseCase(retryWorkflow, logger);
  const resumeRunUseCase = new ResumeRunUseCase(repositories.workflow, repositories.content, retryWorkflow, logger);
  const readRunsUseCase = new ReadRunsUseCase(
    repositories.workflow,
    repositories.content,
    repositories.image,
    repositories.video,
    repositories.upload,
    repositories.log,
    repositories.topic,
    logger,
  );

  // --- Controllers ----------------------------------------------------------
  const deleteRunsUseCase = new DeleteRunsUseCase(repositories.workflow, logger);
  const reconcileRunsUseCase = new ReconcileRunsUseCase(repositories.workflow, logger);

  const topicIdeasAgent = new TopicIdeasAgent(services.nineRouter, services.promptLoader, logger);
  const suggestTopicsUseCase = new SuggestTopicsUseCase(
    new SuggestTopicsWorkflow(topicIdeasAgent, repositories.topic, logger),
    logger,
  );

  const manageSchedulesUseCase = new ManageSchedulesUseCase(repositories.schedule, logger);
  const manageCredentialsUseCase = new ManageCredentialsUseCase(
    repositories.credential,
    secretBox,
    logger,
  );
  // Null when nothing can open a browser: the button that starts a sign-in has
  // to be absent rather than present and broken.
  const capturers = {
    ...(services.playwright === null ? {} : { [CredentialPlatform.TikTok]: services.playwright }),
    ...(services.youtube === null ? {} : { [CredentialPlatform.YouTube]: services.youtube }),
  };
  const captureSessionUseCase =
    Object.keys(capturers).length === 0
      ? null
      : new CaptureSessionUseCase(
          capturers,
          manageCredentialsUseCase,
          config.tiktokBrowser?.loginTimeoutMs ?? config.youtubeBrowser?.loginTimeoutMs ?? 0,
          logger,
        );
  const runSchedulesUseCase = new RunSchedulesUseCase(
    repositories.schedule,
    suggestTopicsUseCase,
    generateContentUseCase,
    logger,
  );

  const readUploadsUseCase = new ReadUploadsUseCase(repositories.upload, logger);
  const manageUploadsUseCase = new ManageUploadsUseCase(
    repositories.upload,
    repositories.workflow,
    repositories.content,
    logger,
  );

  const settleStepUseCase = new SettleStepUseCase(repositories.workflow, logger);
  const publishRunUseCase = new PublishRunUseCase(generateContentWorkflow, logger);

  const httpController = new HttpController(
    readRunsUseCase,
    resumeRunUseCase,
    deleteRunsUseCase,
    generateContentUseCase,
    suggestTopicsUseCase,
    manageSchedulesUseCase,
    manageCredentialsUseCase,
    readUploadsUseCase,
    manageUploadsUseCase,
    settleStepUseCase,
    publishRunUseCase,
    captureSessionUseCase,
    config.image,
    logger,
  );

  const controller = new CliController(
    generateContentUseCase,
    generateTopicUseCase,
    generateScriptUseCase,
    generateSceneUseCase,
    generateImageUseCase,
    generateVoiceUseCase,
    renderVideoUseCase,
    resumeInterruptedUseCase,
    config.content,
    config.image,
    logger,
  );

  return {
    config,
    logger,
    database,
    repositories,
    services,
    controller,
    httpController,
    reconcileRunsUseCase,
    runSchedulesUseCase,
    uploadAgent,
    shutdown: async (): Promise<void> => {
      // Log writes are fire-and-forget; the last of them must land before the
      // pool they use is closed underneath them.
      await persistentLogger?.flush();
      await database.$disconnect();
    },
  };
};
