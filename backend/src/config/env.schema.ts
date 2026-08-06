import { z } from 'zod';

import { Environment } from './app.config.js';
import { LogLevel } from '../types/logger.js';
import {
  DEFAULT_PIPELINE_LAST_STEP,
  IMPLEMENTED_PIPELINE_STEPS,
  WorkflowStepName,
} from '../types/workflow.js';

/**
 * Comma-separated list of positive integers, e.g. `"1000,3000,10000"`.
 *
 * Validated as text here and converted to numbers in the config loader, so the
 * schema stays a description of the environment rather than a transformation
 * pipeline.
 */
const backoffList = z
  .string()
  .regex(/^\d+(,\d+)*$/, 'must be a comma-separated list of millisecond delays');

/** Splits a validated backoff list into milliseconds. */
export const parseBackoffList = (raw: string): readonly number[] =>
  raw.split(',').map((part) => Number(part));

/**
 * Accepts `debug` as readily as `DEBUG`.
 *
 * Log levels are typed in upper case, but every `.env` in the wild writes them
 * lower case; rejecting that would be pedantry, not validation.
 */
const logLevel = z.preprocess(
  (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  z.enum(LogLevel),
);

/**
 * How far the pipeline is allowed to run.
 *
 * Restricted to steps that are actually implemented, so asking for one that is
 * not fails at startup with the list of valid answers — rather than half way
 * through a run that has already paid a model for a topic and a script.
 */
const pipelineLastStep = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.toUpperCase().trim() : value),
    z.enum(WorkflowStepName),
  )
  .refine((step) => IMPLEMENTED_PIPELINE_STEPS.includes(step), {
    message: `must be one of: ${IMPLEMENTED_PIPELINE_STEPS.join(', ')}`,
  });

/**
 * Shape every environment variable must satisfy before the application boots.
 *
 * Defaults exist only for values that are safe in every environment; secrets,
 * connection strings and model endpoints are deliberately required so a missing
 * `.env` fails loudly instead of silently falling back.
 */
/**
 * An optional setting that may be written as an empty value.
 *
 * `KEY=` in a `.env` file is how someone turns something off without deleting
 * the line and forgetting it existed. Zod sees an empty string — present, but
 * too short — so every optional string needs this or it rejects the file.
 */
const optionalText = (schema: z.ZodString = z.string().min(1)) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(Environment).default(Environment.Development),

    LOG_LEVEL: logLevel.default(LogLevel.Info),
    LOG_PERSIST: z.stringbool().default(true),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(100).default(10),

    WORKFLOW_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    WORKFLOW_BACKOFF_MS: backoffList.default('1000,3000,10000'),

    // --- 9 Router ----------------------------------------------------------
    // One router fronts every model. Which model answers is decided by a combo
    // alias configured inside the router, never by an identifier in this code.
    NINE_ROUTER_BASE_URL: z.url('NINE_ROUTER_BASE_URL must be a valid URL'),
    NINE_ROUTER_API_KEY: z.string().min(1, 'NINE_ROUTER_API_KEY is required'),
    NINE_ROUTER_TEXT_COMBO: z.string().min(1, 'NINE_ROUTER_TEXT_COMBO is required'),
    NINE_ROUTER_IMAGE_COMBO: z.string().min(1, 'NINE_ROUTER_IMAGE_COMBO is required'),
    NINE_ROUTER_TIMEOUT: z.coerce.number().int().positive().default(60_000),
    NINE_ROUTER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    NINE_ROUTER_BACKOFF_MS: backoffList.default('1000,3000,10000'),

    // --- HTTP API -----------------------------------------------------------
    HTTP_PORT: z.coerce.number().int().positive().max(65_535).default(4000),

    // --- Credentials ---------------------------------------------------------
    // Encrypts the publishing accounts at rest. Any length; it is hashed to the
    // 32 bytes AES needs. Change it and every stored credential stops opening.
    CREDENTIALS_KEY: z.string().min(16, 'CREDENTIALS_KEY must be at least 16 characters'),

    // --- Speech through the 9 Router ---------------------------------------
    // The only speech server there is, so the key is required.
    ROUTER_SPEECH_BASE_URL: z.url().default('https://router.fauzyan.my.id/v1'),
    ROUTER_SPEECH_API_KEY: z.string().min(1, 'ROUTER_SPEECH_API_KEY is required'),
    ROUTER_SPEECH_MODEL_PREFIX: z.string().min(1).default('google-tts'),
    ROUTER_SPEECH_LANGUAGE: z.string().min(2).max(8).default('en'),
    ROUTER_SPEECH_TIMEOUT: z.coerce.number().int().positive().default(120_000),
    ROUTER_SPEECH_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
    ROUTER_SPEECH_BACKOFF_MS: backoffList.default('1000,3000,10000'),

    // --- Narration ---------------------------------------------------------
    // Speaking rate used to estimate how long a block takes to read. Subtitle
    // timing is derived from it, so it is configuration rather than a constant.
    NARRATION_WORDS_PER_MINUTE: z.coerce.number().int().positive().max(400).default(150),

    // --- FFmpeg (video rendering) ------------------------------------------
    // Resolved from PATH by default; set an absolute path when the binary is
    // somewhere the process environment does not advertise.
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FFPROBE_PATH: z.string().min(1).default('ffprobe'),
    VIDEO_WIDTH: z.coerce.number().int().positive().max(4320).default(1080),
    VIDEO_HEIGHT: z.coerce.number().int().positive().max(7680).default(1920),
    VIDEO_FPS: z.coerce.number().int().positive().max(120).default(30),
    VIDEO_CODEC: z.string().min(1).default('libx264'),
    AUDIO_CODEC: z.string().min(1).default('aac'),
    VIDEO_PRESET: z.string().min(1).default('medium'),
    VIDEO_CRF: z.coerce.number().int().min(0).max(51).default(23),
    // Rendering is expensive and a failure is rarely transient, so the budget
    // is deliberately smaller than the router's.
    VIDEO_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
    VIDEO_BACKOFF_MS: backoffList.default('2000,10000'),
    // A whole render, not one request: minutes, not seconds.
    // Above half the frame the captions stop being captions, so that is the cap.
    VIDEO_SUBTITLE_BOTTOM_FRACTION: z.coerce.number().positive().max(0.5).default(0.16),
    VIDEO_COVER_AT_FRACTION: z.coerce.number().min(0).max(1).default(0.35),
    VIDEO_TIMEOUT: z.coerce.number().int().positive().default(900_000),
    /** How far a camera move travels over a scene, as a fraction of the frame. */
    VIDEO_CAMERA_INTENSITY: z.coerce.number().min(0).max(0.5).default(0.12),
    /** Length of a fade or crossfade between scenes, in seconds. */
    VIDEO_TRANSITION_SECONDS: z.coerce.number().min(0).max(3).default(0.5),

    // --- Background music (optional) ---------------------------------------
    // Absent means the renderer simply skips the music track.
    BACKGROUND_MUSIC_PATH: optionalText(),

    // Browser publishing. Unset TIKTOK_UPLOAD_URL to turn it off entirely.
    TIKTOK_UPLOAD_URL: optionalText(),
    TIKTOK_PROFILE_BASE_URL: z.url().default('https://www.tiktok.com'),
    TIKTOK_LOGIN_URL: z.url().default('https://www.tiktok.com/login'),
    // Signing in means captcha, SMS and two-factor. Five minutes is a person
    // finding their phone, not a machine waiting on a machine.
    TIKTOK_LOGIN_TIMEOUT: z.coerce.number().int().positive().default(300_000),
    TIKTOK_MAX_HASHTAGS: z.coerce.number().int().min(0).max(30).default(5),
    TIKTOK_MADE_FOR_KIDS: z.stringbool().default(false),
    TIKTOK_HEADLESS: z.stringbool().default(false),
    TIKTOK_TIMEOUT: z.coerce.number().int().positive().default(120_000),
    TIKTOK_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(1),
    TIKTOK_BACKOFF_MS: z.string().default('5000,15000'),

    // Browser publishing to YouTube. Unset YOUTUBE_UPLOAD_URL to turn it off.
    // Deliberately channel-agnostic: `/upload` redirects into Studio's upload
    // dialog for whichever channel the session belongs to. A URL with a channel
    // id in it is one more thing to get wrong, and getting it wrong lands on a
    // page with no uploader on it at all.
    YOUTUBE_UPLOAD_URL: optionalText(),
    YOUTUBE_PROFILE_BASE_URL: z.url().default('https://www.youtube.com'),
    // The `continue` matters: the capture watches for YouTube's own cookies,
    // and Google will happily finish a sign-in on myaccount.google.com where
    // those never get set. This sends the last redirect to YouTube.
    YOUTUBE_LOGIN_URL: z.url().default(
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
    ),
    YOUTUBE_LOGIN_TIMEOUT: z.coerce.number().int().positive().default(300_000),
    // YouTube's own ceiling: it ignores hashtags past the fifteenth.
    YOUTUBE_MAX_HASHTAGS: z.coerce.number().int().min(0).max(30).default(15),
    YOUTUBE_MADE_FOR_KIDS: z.stringbool().default(false),
    YOUTUBE_HEADLESS: z.stringbool().default(false),
    YOUTUBE_TIMEOUT: z.coerce.number().int().positive().default(180_000),
    YOUTUBE_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(1),
    YOUTUBE_BACKOFF_MS: z.string().default('5000,15000'),
    BACKGROUND_MUSIC_VOLUME: z.coerce.number().min(0).max(1).default(0.12),

    // --- Pipeline ----------------------------------------------------------
    PIPELINE_LAST_STEP: pipelineLastStep.default(DEFAULT_PIPELINE_LAST_STEP),

    // --- Content generation ------------------------------------------------
    TOPIC_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),
    TOPIC_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
    SCRIPT_TARGET_DURATION_SECONDS: z.coerce.number().int().positive().max(600).default(45),

    // --- Image generation --------------------------------------------------
    // Portrait by default: the pipeline targets short-form vertical video.
    IMAGE_WIDTH: z.coerce.number().int().positive().max(4096).default(1024),
    IMAGE_HEIGHT: z.coerce.number().int().positive().max(4096).default(1792),
    IMAGE_QUALITY: z.string().min(1).default('high detail, sharp focus, 8k'),

    OUTPUT_DIR: z.string().min(1).default('output'),
    PROMPTS_DIR: z.string().min(1).default('src/prompts'),
  })
  .refine((env) => parseBackoffList(env.WORKFLOW_BACKOFF_MS).length >= env.WORKFLOW_MAX_RETRIES, {
    message: 'WORKFLOW_BACKOFF_MS must provide one delay per retry attempt',
    path: ['WORKFLOW_BACKOFF_MS'],
  })
  .refine(
    (env) => parseBackoffList(env.NINE_ROUTER_BACKOFF_MS).length >= env.NINE_ROUTER_MAX_RETRIES,
    {
      message: 'NINE_ROUTER_BACKOFF_MS must provide one delay per retry attempt',
      path: ['NINE_ROUTER_BACKOFF_MS'],
    },
  )
  .refine(
    (env) => parseBackoffList(env.ROUTER_SPEECH_BACKOFF_MS).length >= env.ROUTER_SPEECH_MAX_RETRIES,
    {
      message: 'ROUTER_SPEECH_BACKOFF_MS must provide one delay per retry attempt',
      path: ['ROUTER_SPEECH_BACKOFF_MS'],
    },
  )
  .refine((env) => parseBackoffList(env.VIDEO_BACKOFF_MS).length >= env.VIDEO_MAX_RETRIES, {
    message: 'VIDEO_BACKOFF_MS must provide one delay per retry attempt',
    path: ['VIDEO_BACKOFF_MS'],
  });

/** Environment variables after coercion and validation. */
export type ValidatedEnv = z.infer<typeof envSchema>;
