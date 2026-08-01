import { describe, expect, it } from 'vitest';

import type { HuggingFaceConfig } from '../../../src/config/app.config.js';
import {
  describeProviderFailure,
  HttpHuggingFaceImageService,
} from '../../../src/services/huggingface-image.service.js';
import type { HttpFetch } from '../../../src/services/nine-router.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';

/** Backoff of 1ms keeps the retry path real without slowing the suite. */
const config: HuggingFaceConfig = {
  baseUrl: 'https://router.test',
  apiKey: 'hf-test',
  model: 'fal-ai/fal-ai/flux/dev',
  timeoutMs: 5000,
  retry: { maxRetries: 2, backoffMs: [1, 1] },
};

const request = { prompt: 'a lighthouse at dusk', width: 1080, height: 1920 };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const imageResponse = (bytes: Uint8Array): Response =>
  new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });

/** Records every call so the request itself can be asserted. */
const recordingFetch = (
  responses: readonly (() => Response)[],
): { fetch: HttpFetch; calls: { url: string; init: RequestInit }[] } => {
  const calls: { url: string; init: RequestInit }[] = [];
  let call = 0;

  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      const respond = responses[call] ?? responses[responses.length - 1];
      call += 1;

      return Promise.resolve((respond ?? (() => new Response(null, { status: 500 })))());
    },
  };
};

const serviceWith = (
  responses: readonly (() => Response)[],
): { service: HttpHuggingFaceImageService; calls: { url: string; init: RequestInit }[] } => {
  const { fetch, calls } = recordingFetch(responses);

  return { service: new HttpHuggingFaceImageService(config, new NoopLogger(), fetch), calls };
};

describe('describeProviderFailure', () => {
  it('lifts the router own explanation out of the body', () => {
    expect(
      describeProviderFailure(JSON.stringify({ error: 'The requested model is deprecated' })),
    ).toBe('The requested model is deprecated');
  });

  it('keeps a provider field-validation complaint', () => {
    // The providers answer a bad payload with `detail`, and that names the
    // field — which is exactly what tells an operator the route changed shape.
    const described = describeProviderFailure(
      JSON.stringify({ detail: [{ loc: ['body', 'prompt'], msg: 'Field required' }] }),
    );

    expect(described).toContain('Field required');
  });

  it('returns nothing for a gateway HTML page', () => {
    expect(describeProviderFailure('<!DOCTYPE html><html>502</html>')).toBeNull();
  });
});

describe('HttpHuggingFaceImageService', () => {
  it('posts the prompt to the configured model route', async () => {
    // `prompt` and `image_size` are the field names the providers accept; the
    // older `inputs` field is rejected outright.
    const { service, calls } = serviceWith([
      () => jsonResponse({ images: [{ url: 'https://files.test/a.jpg' }] }),
      () => imageResponse(new Uint8Array([1, 2, 3])),
    ]);

    await service.generateImage(request);

    expect(calls[0]?.url).toBe('https://router.test/fal-ai/fal-ai/flux/dev');
    expect(JSON.parse((calls[0]?.init.body ?? '') as string)).toEqual({
      prompt: 'a lighthouse at dusk',
      image_size: { width: 1080, height: 1920 },
    });
  });

  it('authenticates with the configured key', async () => {
    const { service, calls } = serviceWith([() => imageResponse(new Uint8Array([1]))]);

    await service.generateImage(request);

    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer hf-test');
  });

  it('downloads an image the provider chose to host', async () => {
    const { service, calls } = serviceWith([
      () => jsonResponse({ images: [{ url: 'https://files.test/a.jpg' }] }),
      () => imageResponse(new Uint8Array([9, 9, 9])),
    ]);

    const generated = await service.generateImage(request);

    expect(calls[1]?.url).toBe('https://files.test/a.jpg');
    expect(generated.data).toEqual(new Uint8Array([9, 9, 9]));
    expect(generated.mimeType).toBe('image/jpeg');
  });

  it('takes the bytes directly when the provider streams them', async () => {
    const { service, calls } = serviceWith([() => imageResponse(new Uint8Array([7, 7]))]);

    const generated = await service.generateImage(request);

    expect(calls).toHaveLength(1);
    expect(generated.data).toEqual(new Uint8Array([7, 7]));
  });

  it('decodes an inlined image', async () => {
    const { service } = serviceWith([
      () => jsonResponse({ images: [{ b64_json: Buffer.from([4, 2]).toString('base64') }] }),
    ]);

    const generated = await service.generateImage(request);

    expect(generated.data).toEqual(Buffer.from([4, 2]));
  });

  it('reports the configured model as the combo, for provenance', async () => {
    const { service } = serviceWith([() => imageResponse(new Uint8Array([1]))]);

    expect((await service.generateImage(request)).combo).toBe('fal-ai/fal-ai/flux/dev');
  });

  it('retries a transient failure and succeeds', async () => {
    let call = 0;
    const { service } = serviceWith([
      () => {
        call += 1;
        return call === 1
          ? jsonResponse({ error: 'overloaded' }, 503)
          : imageResponse(new Uint8Array([1]));
      },
    ]);

    const generated = await service.generateImage(request);

    expect(generated.data).toEqual(new Uint8Array([1]));
  });

  it('does not retry a rejection that cannot become correct', async () => {
    // A deprecated model answers 410 every time; spending the budget on it only
    // delays the report of a problem that needs a configuration change.
    const { service, calls } = serviceWith([
      () => jsonResponse({ error: 'The requested model is deprecated' }, 410),
    ]);

    await expect(service.generateImage(request)).rejects.toMatchObject({
      code: ErrorCode.ImageProviderRequestFailed,
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('reports an exhausted budget as final, so a caller cannot square it', async () => {
    const { service, calls } = serviceWith([() => jsonResponse({ error: 'overloaded' }, 503)]);

    await expect(service.generateImage(request)).rejects.toMatchObject({
      code: ErrorCode.ImageProviderRetriesExhausted,
      retryable: false,
    });
    expect(calls).toHaveLength(config.retry.maxRetries + 1);
  });

  it('rejects an answer that carries no image', async () => {
    // An empty answer is treated as transient, so it is attempted again and
    // surfaces as an exhausted budget. The original diagnosis is kept as the
    // cause: without it the operator would see only "it kept failing".
    const { service } = serviceWith([() => jsonResponse({ images: [] })]);

    await expect(service.generateImage(request)).rejects.toMatchObject({
      code: ErrorCode.ImageProviderRetriesExhausted,
      details: { cause: { code: ErrorCode.ImageProviderInvalidResponse } },
    });
  });

  it('rejects an entry with neither bytes nor a URL', async () => {
    const { service } = serviceWith([() => jsonResponse({ images: [{}] })]);

    await expect(service.generateImage(request)).rejects.toMatchObject({
      code: ErrorCode.ImageProviderRetriesExhausted,
      details: { cause: { code: ErrorCode.ImageProviderInvalidResponse } },
    });
  });
});
