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
 * The key that encrypts stored account credentials.
 *
 * Never written to the database. An operator who loses it loses the ability to
 * read the credentials, which is the trade a secret store exists to make.
 */
export interface CredentialsConfig {
  readonly key: string;
}

/**
 * Driving the TikTok web application with a real browser.
 *
 * Null when `TIKTOK_UPLOAD_URL` is unset, which is how an installation says it
 * does not publish this way — the same shape as speech, so "not configured"
 * reads identically wherever it appears.
 *
 * The URL is configuration rather than a constant because it is the setting
 * most likely to need changing without a release: TikTok has moved its upload
 * page before and will again.
 */
export interface BrowserPublishConfig {
  /** The upload page, e.g. `https://www.tiktok.com/tiktokstudio/upload`. */
  readonly uploadUrl: string;
  /** Prefix a handle is appended to, e.g. `https://www.tiktok.com/`. */
  readonly profileBaseUrl: string;
  /** Which platform's pages these URLs belong to. */
  readonly platform: 'TIKTOK' | 'YOUTUBE';
  /**
   * How many hashtags to carry into the caption.
   *
   * Per platform because the right number is a property of the platform, not
   * of the script: the writer produces between three and eight, and where a
   * caption is short and the tags compete with the words, fewer is better.
   */
  readonly maxHashtags: number;
  /**
   * Whether uploads declare themselves made for children.
   *
   * A legal declaration on YouTube, not a preference, and it costs the video
   * its comments, its notifications and most of its reach. Configuration
   * rather than a constant because only the person publishing can answer it,
   * and the answer is the same for every video a channel makes.
   */
  readonly madeForKids: boolean;
  /** Where a person is sent to sign in when capturing a session. */
  readonly loginUrl: string;
  /** How long a capture waits for someone to finish signing in. */
  readonly loginTimeoutMs: number;
  /**
   * Whether to hide the browser.
   *
   * Default false. A headless browser is far more likely to be challenged, and
   * an operator watching the first run is how the selectors get confirmed.
   */
  readonly headless: boolean;
  /** Budget for any single wait — file processing, posting, confirmation. */
  readonly timeoutMs: number;
  readonly retry: RetryConfig;
}

/**
 * Settings for text to speech through the 9 Router.
 *
 * The router fronts Google's voices as `google-tts/{language}` — one voice per
 * language, so the language *is* the voice. The only speech system the pipeline
 * talks to, which is why it is never null.
 */
export interface RouterSpeechConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Everything before the language, e.g. `google-tts`. */
  readonly modelPrefix: string;
  /** Language spoken, e.g. `en`. */
  readonly language: string;
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
  /**
   * How far the captions sit above the bottom edge, as a fraction of height.
   *
   * Configurable because the right value is not a property of the video: it is
   * a property of wherever it is watched. TikTok draws its own caption, handle
   * and progress bar over the bottom of the frame, so burned-in text placed for
   * a bare 9:16 file ends up underneath them.
   */
  readonly subtitleBottomFraction: number;
  /**
   * How far through the video the cover still is taken from, 0–1.
   *
   * A judgement rather than a measurement, so it belongs in configuration: far
   * enough in to be past the hook, early enough to still be the subject.
   */
  readonly coverAtFraction: number;
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
/** Where the HTTP API listens. */
export interface HttpConfig {
  readonly port: number;
}

export interface AppConfig {
  readonly runtime: RuntimeConfig;
  readonly http: HttpConfig;
  readonly credentials: CredentialsConfig;
  readonly logging: LoggingConfig;
  readonly database: DatabaseConfig;
  readonly workflow: WorkflowConfig;
  readonly nineRouter: NineRouterConfig;
  readonly routerSpeech: RouterSpeechConfig;
  /** Null when this installation does not publish to TikTok through a browser. */
  readonly tiktokBrowser: BrowserPublishConfig | null;
  /** Null when this installation does not publish to YouTube through a browser. */
  readonly youtubeBrowser: BrowserPublishConfig | null;
  readonly narration: NarrationConfig;
  readonly video: VideoConfig;
  readonly backgroundMusic: BackgroundMusicConfig;
  readonly pipeline: PipelineConfig;
  readonly content: ContentConfig;
  readonly image: ImageConfig;
  readonly media: MediaConfig;
}
