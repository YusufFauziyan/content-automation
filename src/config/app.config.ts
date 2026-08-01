import type { LogLevel } from '../types/logger.js';
import type { WorkflowStepName } from '../types/workflow.js';

/** Deployment environment the process is running in. */
export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** Process-level settings. */
export interface RuntimeConfig {
  readonly environment: Environment;
}

/** Diagnostics settings. */
export interface LoggingConfig {
  /** Records below this severity are discarded. */
  readonly level: LogLevel;
  /** Mirror every emitted record into PostgreSQL through `LogRepository`. */
  readonly persist: boolean;
}

/** PostgreSQL connection settings consumed by the Prisma driver adapter. */
export interface DatabaseConfig {
  readonly url: string;
  readonly poolSize: number;
}

/**
 * How often, and how patiently, a retryable failure is attempted again.
 *
 * Shared by the workflow and the AI router: the policy is the same idea in both
 * places, only the numbers differ.
 */
export interface RetryConfig {
  readonly maxRetries: number;
  /** Delay before each retry attempt, in milliseconds. */
  readonly backoffMs: readonly number[];
}

/** Retry policy applied by the workflow to retryable step failures. */
export type WorkflowConfig = RetryConfig;

/**
 * Settings for the 9 Router, which fronts every model call the pipeline makes.
 *
 * A "combo" is an alias configured inside the router. The application never
 * names a provider or a model: swapping the image model for a different one is
 * an `.env` change and touches no source file.
 */
export interface NineRouterConfig {
  /** Base URL of the router, e.g. `https://.../v1`. */
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Combo used for text completions. */
  readonly textCombo: string;
  /** Combo used for image generation. */
  readonly imageCombo: string;
  /** Abort a single request after this many milliseconds. */
  readonly timeoutMs: number;
  readonly retry: RetryConfig;
}

/**
 * Settings for the Kokoro text-to-speech server.
 *
 * A separate external system from the router, with its own endpoint, timeout
 * and retry budget — none of which is ever hard-coded.
 */
export interface KokoroConfig {
  /** Base URL of the OpenAI-compatible speech API, e.g. `http://…:8880/v1`. */
  readonly baseUrl: string;
  /** Model identifier the server exposes. */
  readonly model: string;
  /** Voice preset the narration is read in. */
  readonly voice: string;
  /** Playback rate multiplier; `1` is the model's natural pace. */
  readonly speed: number;
  readonly timeoutMs: number;
  readonly retry: RetryConfig;
}

/**
 * Settings for the Hugging Face image fallback.
 *
 * A distinct external system from the 9 Router, with its own endpoint, key,
 * model route, timeout and retry budget. Optional by design: when the key is
 * absent the fallback simply does not exist, and image generation depends on
 * the router alone exactly as before.
 */
export interface HuggingFaceConfig {
  /** Base URL of the inference router, e.g. `https://router.huggingface.co`. */
  readonly baseUrl: string;
  readonly apiKey: string;
  /**
   * Provider route for the image model, e.g. `fal-ai/fal-ai/flux/dev`.
   *
   * The first segment names the inference provider and the rest is that
   * provider's own model id. Configured rather than derived, because which
   * providers serve a given model changes without notice.
   */
  readonly model: string;
  readonly timeoutMs: number;
  readonly retry: RetryConfig;
}

/** How the narration is planned and timed. */
export interface NarrationConfig {
  /**
   * Speaking rate used to estimate block durations.
   *
   * Subtitle timing is derived from these estimates, so the rate belongs in
   * configuration: it has to be tunable per voice and per language without a
   * release.
   */
  readonly wordsPerMinute: number;
}

/**
 * Settings for video rendering.
 *
 * External system: the FFmpeg binary. Every encoder choice is configuration so
 * that changing quality, codec or resolution is a deployment decision and never
 * a code change.
 */
export interface VideoConfig {
  /** Path to the `ffmpeg` binary, or just its name when it is on `PATH`. */
  readonly ffmpegPath: string;
  /** Path to the `ffprobe` binary, used to measure what was produced. */
  readonly ffprobePath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly preset: string;
  /** Constant Rate Factor: lower is better quality and a larger file. */
  readonly crf: number;
  /** How far a camera move travels, as a fraction of the frame. */
  readonly cameraIntensity: number;
  /** Length of a fade or crossfade between scenes, in seconds. */
  readonly transitionSeconds: number;
  readonly timeoutMs: number;
  readonly retry: RetryConfig;
}

/**
 * Optional music bed.
 *
 * `path` being absent is a supported state, not a misconfiguration: the
 * renderer simply produces a video with narration only.
 */
export interface BackgroundMusicConfig {
  readonly path: string | null;
  /** Gain applied to the music, relative to the narration. */
  readonly volume: number;
}

/** How much of the pipeline a run executes. */
export interface PipelineConfig {
  /**
   * Last step a full run performs.
   *
   * Lets the pipeline stop short of a stage whose external system is not ready
   * — a run that ends at `SCENE` is a finished run, not a failed one — without
   * the workflow, the agents or the step list changing at all.
   */
  readonly lastStep: WorkflowStepName;
}

/** Business parameters of text generation. */
export interface ContentConfig {
  /** How many candidate topics to try before giving up on finding a unique one. */
  readonly topicMaxAttempts: number;
  /** Cosine similarity above which a topic counts as a semantic duplicate. */
  readonly topicSimilarityThreshold: number;
  /** Default spoken length a script is written for. */
  readonly scriptTargetDurationSeconds: number;
}

/** Dimensions and quality every generated still is produced at. */
export interface ImageConfig {
  readonly width: number;
  readonly height: number;
  /**
   * Aspect ratio in `w:h` form, derived from the dimensions above.
   *
   * Derived rather than configured so the ratio named in a prompt can never
   * disagree with the pixels actually requested.
   */
  readonly aspectRatio: string;
  /** Quality wording appended to every image prompt. */
  readonly quality: string;
}

/** Locations of disposable media and of the versioned prompt files. */
export interface MediaConfig {
  /** Absolute path to the scratch directory. Everything here is deletable. */
  readonly outputDirectory: string;
  /** Absolute path to the directory holding the prompt files. */
  readonly promptsDirectory: string;
}

/**
 * The fully validated configuration of the application.
 *
 * Built exactly once during startup and injected from there on. No other layer
 * is permitted to read `process.env` (enforced by lint).
 */
export interface AppConfig {
  readonly runtime: RuntimeConfig;
  readonly logging: LoggingConfig;
  readonly database: DatabaseConfig;
  readonly workflow: WorkflowConfig;
  readonly nineRouter: NineRouterConfig;
  /** Absent when no Hugging Face key is configured: the fallback is optional. */
  readonly huggingFace: HuggingFaceConfig | null;
  readonly kokoro: KokoroConfig;
  readonly narration: NarrationConfig;
  readonly video: VideoConfig;
  readonly backgroundMusic: BackgroundMusicConfig;
  readonly pipeline: PipelineConfig;
  readonly content: ContentConfig;
  readonly image: ImageConfig;
  readonly media: MediaConfig;
}
