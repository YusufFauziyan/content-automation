import { isAbsolute, resolve } from 'node:path';

import type { AppConfig } from './app.config.js';
import { envSchema, parseBackoffList, type ValidatedEnv } from './env.schema.js';
import { ConfigurationError } from '../types/errors/configuration.error.js';

/** Raw, unvalidated environment as received from the process. */
export type RawEnvironment = Readonly<Record<string, string | undefined>>;

/** Turns a possibly relative path from the environment into an absolute one. */
const toAbsolutePath = (value: string): string =>
  isAbsolute(value) ? value : resolve(process.cwd(), value);

/** Greatest common divisor, used to reduce a pixel size to its ratio. */
const greatestCommonDivisor = (first: number, second: number): number =>
  second === 0 ? first : greatestCommonDivisor(second, first % second);

/** Reduces `1024 x 1792` to `"4:7"`, the ratio an image model is told to frame for. */
const toAspectRatio = (width: number, height: number): string => {
  const divisor = greatestCommonDivisor(width, height);

  return `${String(width / divisor)}:${String(height / divisor)}`;
};

/** Groups the flat environment into the layered {@link AppConfig}. */
const toAppConfig = (env: ValidatedEnv): AppConfig => ({
  runtime: {
    environment: env.NODE_ENV,
  },
  logging: {
    level: env.LOG_LEVEL,
    persist: env.LOG_PERSIST,
  },
  database: {
    url: env.DATABASE_URL,
    poolSize: env.DATABASE_POOL_SIZE,
  },
  workflow: {
    maxRetries: env.WORKFLOW_MAX_RETRIES,
    backoffMs: parseBackoffList(env.WORKFLOW_BACKOFF_MS),
  },
  nineRouter: {
    baseUrl: env.NINE_ROUTER_BASE_URL.replace(/\/+$/, ''),
    apiKey: env.NINE_ROUTER_API_KEY,
    textCombo: env.NINE_ROUTER_TEXT_COMBO,
    imageCombo: env.NINE_ROUTER_IMAGE_COMBO,
    timeoutMs: env.NINE_ROUTER_TIMEOUT,
    retry: {
      maxRetries: env.NINE_ROUTER_MAX_RETRIES,
      backoffMs: parseBackoffList(env.NINE_ROUTER_BACKOFF_MS),
    },
  },
  // Absent without a key: the fallback is opt-in, and a half-configured one
  // that fails at the moment the router is already down helps nobody.
  huggingFace:
    env.HUGGINGFACE_API_KEY === undefined
      ? null
      : {
          baseUrl: env.HUGGINGFACE_BASE_URL.replace(/\/+$/, ''),
          apiKey: env.HUGGINGFACE_API_KEY,
          model: env.HUGGINGFACE_IMAGE_MODEL.replace(/^\/+/, ''),
          timeoutMs: env.HUGGINGFACE_TIMEOUT,
          retry: {
            maxRetries: env.HUGGINGFACE_MAX_RETRIES,
            backoffMs: parseBackoffList(env.HUGGINGFACE_BACKOFF_MS),
          },
        },
  kokoro: {
    baseUrl: env.KOKORO_BASE_URL.replace(/\/+$/, ''),
    model: env.KOKORO_MODEL,
    voice: env.KOKORO_VOICE,
    speed: env.KOKORO_SPEED,
    timeoutMs: env.KOKORO_TIMEOUT,
    retry: {
      maxRetries: env.KOKORO_MAX_RETRIES,
      backoffMs: parseBackoffList(env.KOKORO_BACKOFF_MS),
    },
  },
  narration: {
    wordsPerMinute: env.NARRATION_WORDS_PER_MINUTE,
  },
  video: {
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    width: env.VIDEO_WIDTH,
    height: env.VIDEO_HEIGHT,
    fps: env.VIDEO_FPS,
    videoCodec: env.VIDEO_CODEC,
    audioCodec: env.AUDIO_CODEC,
    preset: env.VIDEO_PRESET,
    crf: env.VIDEO_CRF,
    cameraIntensity: env.VIDEO_CAMERA_INTENSITY,
    transitionSeconds: env.VIDEO_TRANSITION_SECONDS,
    timeoutMs: env.VIDEO_TIMEOUT,
    retry: {
      maxRetries: env.VIDEO_MAX_RETRIES,
      backoffMs: parseBackoffList(env.VIDEO_BACKOFF_MS),
    },
  },
  backgroundMusic: {
    path:
      env.BACKGROUND_MUSIC_PATH === undefined ? null : toAbsolutePath(env.BACKGROUND_MUSIC_PATH),
    volume: env.BACKGROUND_MUSIC_VOLUME,
  },
  pipeline: {
    lastStep: env.PIPELINE_LAST_STEP,
  },
  content: {
    topicMaxAttempts: env.TOPIC_MAX_ATTEMPTS,
    topicSimilarityThreshold: env.TOPIC_SIMILARITY_THRESHOLD,
    scriptTargetDurationSeconds: env.SCRIPT_TARGET_DURATION_SECONDS,
  },
  image: {
    width: env.IMAGE_WIDTH,
    height: env.IMAGE_HEIGHT,
    aspectRatio: toAspectRatio(env.IMAGE_WIDTH, env.IMAGE_HEIGHT),
    quality: env.IMAGE_QUALITY,
  },
  media: {
    outputDirectory: toAbsolutePath(env.OUTPUT_DIR),
    promptsDirectory: toAbsolutePath(env.PROMPTS_DIR),
  },
});

/**
 * Validates the environment and builds the application configuration.
 *
 * Called exactly once, from the composition root, before anything else is
 * constructed. An invalid environment aborts startup instead of surfacing as a
 * confusing failure deep inside a workflow.
 *
 * @param env Raw environment. Injectable so tests never touch `process.env`.
 * @throws {ConfigurationError} When one or more variables are missing or invalid.
 */
export const loadConfig = (env: RawEnvironment = process.env): AppConfig => {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      variable: issue.path.join('.'),
      problem: issue.message,
    }));

    throw new ConfigurationError('Environment validation failed.', { issues });
  }

  return toAppConfig(parsed.data);
};
