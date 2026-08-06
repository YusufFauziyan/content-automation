import { describe, expect, it } from 'vitest';

import { Environment } from '../../../src/config/app.config.js';
import { loadConfig, type RawEnvironment } from '../../../src/config/config.loader.js';
import { ConfigurationError } from '../../../src/types/errors/configuration.error.js';
import { LogLevel } from '../../../src/types/logger.js';
import { WorkflowStepName } from '../../../src/types/workflow.js';

/** The smallest environment the application will boot with. */
const VALID_ENV: RawEnvironment = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  NINE_ROUTER_BASE_URL: 'https://router.test/v1',
  NINE_ROUTER_API_KEY: 'sk-test',
  CREDENTIALS_KEY: 'a-test-key-long-enough',
  NINE_ROUTER_TEXT_COMBO: 'opus',
  NINE_ROUTER_IMAGE_COMBO: 'gemini-image',
  ROUTER_SPEECH_API_KEY: 'sk-speech-test',
};

describe('loadConfig', () => {
  it('applies documented defaults when only the required variables are set', () => {
    const config = loadConfig(VALID_ENV);

    expect(config.runtime.environment).toBe(Environment.Development);
    expect(config.logging.level).toBe(LogLevel.Info);
    expect(config.workflow.maxRetries).toBe(3);
    expect(config.workflow.backoffMs).toEqual([1000, 3000, 10000]);
  });

  it('rejects a missing database url instead of falling back', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
  });

  it('resolves media paths to absolute locations', () => {
    const config = loadConfig({ ...VALID_ENV, OUTPUT_DIR: 'output' });

    expect(config.media.outputDirectory.startsWith('/')).toBe(true);
  });

  it('rejects a backoff list shorter than the retry budget', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, WORKFLOW_MAX_RETRIES: '3', WORKFLOW_BACKOFF_MS: '1000' }),
    ).toThrow(ConfigurationError);
  });

  it('accepts a lower-case log level', () => {
    const config = loadConfig({ ...VALID_ENV, LOG_LEVEL: 'debug' });

    expect(config.logging.level).toBe(LogLevel.Debug);
  });

  it('exposes the router combos without a hard-coded model', () => {
    const config = loadConfig({
      ...VALID_ENV,
      NINE_ROUTER_TEXT_COMBO: 'sonnet',
      NINE_ROUTER_IMAGE_COMBO: 'some-image-combo',
    });

    expect(config.nineRouter.textCombo).toBe('sonnet');
    expect(config.nineRouter.imageCombo).toBe('some-image-combo');
    expect(config.nineRouter.baseUrl).toBe('https://router.test/v1');
  });

  it('rejects a missing router api key', () => {
    const { NINE_ROUTER_API_KEY: _key, ...withoutKey } = VALID_ENV;

    expect(() => loadConfig(withoutKey)).toThrow(ConfigurationError);
  });

  it('rejects a missing image combo, because nothing may default to a provider', () => {
    const { NINE_ROUTER_IMAGE_COMBO: _combo, ...withoutCombo } = VALID_ENV;

    expect(() => loadConfig(withoutCombo)).toThrow(ConfigurationError);
  });

  it('exposes image dimensions for the visual pipeline', () => {
    const config = loadConfig({ ...VALID_ENV, IMAGE_WIDTH: '720', IMAGE_HEIGHT: '1280' });

    expect(config.image.width).toBe(720);
    expect(config.image.height).toBe(1280);
  });

  it('runs the whole implemented pipeline by default', () => {
    const config = loadConfig(VALID_ENV);

    expect(config.pipeline.lastStep).toBe(WorkflowStepName.Upload);
  });

  it('exposes the speech settings without a hard-coded language', () => {
    const config = loadConfig({
      ...VALID_ENV,
      ROUTER_SPEECH_LANGUAGE: 'id',
      ROUTER_SPEECH_BASE_URL: 'https://speech.test/v1',
    });

    expect(config.routerSpeech.language).toBe('id');
    expect(config.routerSpeech.modelPrefix).toBe('google-tts');
    expect(config.routerSpeech.baseUrl).toBe('https://speech.test/v1');
  });

  it('rejects a missing speech api key, because nothing else can speak', () => {
    const { ROUTER_SPEECH_API_KEY: _key, ...withoutKey } = VALID_ENV;

    expect(() => loadConfig(withoutKey)).toThrow(ConfigurationError);
  });

  it('exposes the speaking rate that subtitle timing derives from', () => {
    const config = loadConfig({ ...VALID_ENV, NARRATION_WORDS_PER_MINUTE: '180' });

    expect(config.narration.wordsPerMinute).toBe(180);
  });

  it('lets a deployment stop the pipeline early', () => {
    const config = loadConfig({ ...VALID_ENV, PIPELINE_LAST_STEP: 'SCENE' });

    expect(config.pipeline.lastStep).toBe(WorkflowStepName.Scene);
  });

  it('accepts a lower-case step name', () => {
    const config = loadConfig({ ...VALID_ENV, PIPELINE_LAST_STEP: 'scene' });

    expect(config.pipeline.lastStep).toBe(WorkflowStepName.Scene);
  });

  it('refuses a step that is declared but not implemented', () => {
    // CLEANUP is in PIPELINE_STEPS and has no agent behind it. Asking to stop
    // there has to fail at startup rather than at three in the morning.
    expect(() => loadConfig({ ...VALID_ENV, PIPELINE_LAST_STEP: 'CLEANUP' })).toThrow(
      ConfigurationError,
    );
  });

  it('refuses a step that does not exist at all', () => {
    expect(() => loadConfig({ ...VALID_ENV, PIPELINE_LAST_STEP: 'NONSENSE' })).toThrow(
      ConfigurationError,
    );
  });

  it('reports which variable failed', () => {
    try {
      loadConfig({});
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).retryable).toBe(false);
      expect(JSON.stringify((error as ConfigurationError).details)).toContain('DATABASE_URL');
    }
  });
});
