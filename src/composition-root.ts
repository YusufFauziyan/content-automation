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
import { TopicRepository } from './repositories/topic.repository.js';
import { UploadRepository } from './repositories/upload.repository.js';
import { WorkflowRepository } from './repositories/workflow.repository.js';
import { ProcessFfmpegService, type FfmpegService } from './services/ffmpeg.service.js';
import {
  HttpHuggingFaceImageService,
  type HuggingFaceImageService,
} from './services/huggingface-image.service.js';
import { HttpKokoroService, type KokoroService } from './services/kokoro.service.js';
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
import { ResumeInterruptedUseCase } from './use-cases/resume-interrupted.usecase.js';
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
}

/** Every external-system adapter that exists today. */
export interface Services {
  readonly nineRouter: NineRouterService;
  /** Null unless a Hugging Face key is configured: the image fallback is opt-in. */
  readonly huggingFace: HuggingFaceImageService | null;
  readonly kokoro: KokoroService;
  readonly ffmpeg: FfmpegService;
  readonly promptLoader: PromptLoader;
  readonly subtitle: SubtitleService;
  readonly workingDirectory: WorkingDirectoryService;
}

/** The assembled application. */
export interface Application {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: Database;
  readonly repositories: Repositories;
  readonly services: Services;
  readonly controller: CliController;
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
  };

  // --- Cross-cutting concerns ----------------------------------------------
  const consoleLogger = new StructuredLogger(config.logging.level);
  const persistentLogger = config.logging.persist
    ? new PersistentLogger(consoleLogger, repositories.log, config.logging.level)
    : null;
  const logger: Logger = persistentLogger ?? consoleLogger;

  const retryExecutor = new RetryExecutor(config.workflow, logger);

  // --- Services -------------------------------------------------------------
  const services: Services = {
    nineRouter: new HttpNineRouterService(config.nineRouter, logger),
    huggingFace:
      config.huggingFace === null
        ? null
        : new HttpHuggingFaceImageService(config.huggingFace, logger),
    kokoro: new HttpKokoroService(config.kokoro, logger),
    ffmpeg: new ProcessFfmpegService(config.video, logger),
    promptLoader: new FilePromptLoader(config.media),
    subtitle: new SrtSubtitleService(),
    workingDirectory: new LocalWorkingDirectoryService(config.media),
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
    config.image,
    logger,
  );
  const imageAgent = new ImageAgent(
    services.nineRouter,
    services.huggingFace,
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
    config.kokoro.speed,
    logger,
  );
  const voiceAgent = new VoiceAgent(
    services.kokoro,
    services.ffmpeg,
    services.workingDirectory,
    repositories.content,
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
    logger,
  );

  // --- Workflows ------------------------------------------------------------
  const generateContentWorkflow = new GenerateContentWorkflow(
    repositories.workflow,
    repositories.topic,
    repositories.content,
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

  // --- Controllers ----------------------------------------------------------
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
    shutdown: async (): Promise<void> => {
      // Log writes are fire-and-forget; the last of them must land before the
      // pool they use is closed underneath them.
      await persistentLogger?.flush();
      await database.$disconnect();
    },
  };
};
