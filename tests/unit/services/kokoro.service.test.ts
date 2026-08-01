import { describe, expect, it } from 'vitest';

import type { KokoroConfig } from '../../../src/config/app.config.js';
import { HttpKokoroService, type HttpFetch } from '../../../src/services/kokoro.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import {
  SpeechRetriesExhaustedError,
  SpeechServiceError,
} from '../../../src/types/errors/speech.error.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';

/** Backoff of 1ms keeps the retry path real without slowing the suite. */
const config: KokoroConfig = {
  baseUrl: 'http://kokoro.test/v1',
  model: 'kokoro',
  voice: 'af_heart',
  speed: 1.1,
  timeoutMs: 5000,
  retry: { maxRetries: 2, backoffMs: [1, 1] },
};

/** Enough bytes to pass the "this is actually audio" floor. */
const audio = (): Response =>
  new Response(new Uint8Array(4096), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });

const recordingFetch = (
  responses: readonly (() => Response)[],
): { fetch: HttpFetch; calls: { url: string; init: RequestInit }[] } => {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;

  const fetch: HttpFetch = (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return Promise.resolve(next!());
  };

  return { fetch, calls };
};

const request = { text: 'Artificial intelligence is changing programming.' } as const;

/** Reads the code of the failure a retry wrapper is reporting. */
const causeCode = (error: unknown): string | undefined => {
  const details = (error as { details?: Record<string, unknown> }).details ?? {};
  const cause = details['cause'] as { code?: string } | undefined;

  return cause?.code ?? (error as { code?: string }).code;
};

describe('HttpKokoroService', () => {
  it('returns the audio bytes and what produced them', async () => {
    const { fetch } = recordingFetch([audio]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    const spoken = await service.synthesize(request);

    expect(spoken.data.byteLength).toBe(4096);
    expect(spoken.mimeType).toBe('audio/mpeg');
    expect(spoken.voice).toBe('af_heart');
    expect(spoken.model).toBe('kokoro');
    expect(spoken.speed).toBe(1.1);
  });

  it('sends the configured model, voice and speed, never a hard-coded one', async () => {
    const { fetch, calls } = recordingFetch([audio]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    await service.synthesize(request);

    expect(calls[0]?.url).toBe('http://kokoro.test/v1/audio/speech');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      model: 'kokoro',
      voice: 'af_heart',
      speed: 1.1,
      input: request.text,
      response_format: 'mp3',
    });
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    const { fetch, calls } = recordingFetch([() => new Response('busy', { status: 503 }), audio]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    await expect(service.synthesize(request)).resolves.toMatchObject({ voice: 'af_heart' });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a rejected request', async () => {
    const { fetch, calls } = recordingFetch([() => new Response('bad input', { status: 400 })]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    await expect(service.synthesize(request)).rejects.toBeInstanceOf(SpeechServiceError);
    expect(calls).toHaveLength(1);
  });

  it('reports an exhausted budget as not retryable', async () => {
    const { fetch, calls } = recordingFetch([() => new Response('busy', { status: 500 })]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    const error = await service.synthesize(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpeechRetriesExhaustedError);
    expect((error as SpeechRetriesExhaustedError).retryable).toBe(false);
    expect(calls).toHaveLength(config.retry.maxRetries + 1);
  });

  it('surfaces the server own explanation instead of the raw body', async () => {
    const { fetch } = recordingFetch([
      () =>
        new Response(JSON.stringify({ detail: 'Voice af_nope does not exist' }), { status: 400 }),
    ]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    const error = await service.synthesize(request).catch((caught: unknown) => caught);

    expect((error as SpeechServiceError).message).toContain('af_nope');
  });

  it('maps a connection that dies mid-body onto a retryable failure', async () => {
    const dying = (): Response =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('other side closed'));
          },
        }),
        { status: 200, headers: { 'content-type': 'audio/mpeg' } },
      );
    const { fetch, calls } = recordingFetch([dying]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    const error = await service.synthesize(request).catch((caught: unknown) => caught);

    // Retried like any transport failure, then reported as exhausted — never
    // allowed to escape as an untyped exception.
    expect(error).toBeInstanceOf(SpeechRetriesExhaustedError);
    expect(causeCode(error)).toBe(ErrorCode.SpeechRequestFailed);
    expect(calls).toHaveLength(config.retry.maxRetries + 1);
  });

  it('refuses a response too small to be audio', async () => {
    const { fetch } = recordingFetch([() => new Response(new Uint8Array(10), { status: 200 })]);
    const service = new HttpKokoroService(config, new NoopLogger(), fetch);

    const error = await service.synthesize(request).catch((caught: unknown) => caught);

    expect(causeCode(error)).toBe(ErrorCode.SpeechInvalidResponse);
  });
});
