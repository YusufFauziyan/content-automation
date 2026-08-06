import { describe, expect, it } from 'vitest';

import type { NineRouterConfig } from '../../../src/config/app.config.js';
import {
  AiMessageRole,
  HttpNineRouterService,
  type HttpFetch,
} from '../../../src/services/nine-router.service.js';
import {
  AiInvalidResponseError,
  AiRetriesExhaustedError,
  AiRouterError,
} from '../../../src/types/errors/ai-router.error.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';

/** Backoff of 1ms keeps the retry path real without slowing the suite. */
const config: NineRouterConfig = {
  baseUrl: 'https://router.test/v1',
  apiKey: 'sk-test',
  textCombo: 'opus',
  imageCombo: 'image-combo',
  timeoutMs: 5000,
  retry: { maxRetries: 2, backoffMs: [1, 1] },
};

const chatResponse = (content: string): Response =>
  new Response(
    JSON.stringify({
      model: 'opus',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

/** Records every call so the request itself can be asserted. */
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

const request = {
  messages: [{ role: AiMessageRole.User, content: 'hello' }],
} as const;

/** Reads the code of the failure a retry wrapper is reporting. */
const causeCode = (error: unknown): string | undefined => {
  const details = (error as { details?: Record<string, unknown> }).details ?? {};
  const cause = details['cause'] as { code?: string } | undefined;

  return cause?.code ?? (error as { code?: string }).code;
};

/** A one-pixel PNG, base64 encoded — enough to prove the bytes round-trip. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const imageResponse = (entry: Record<string, unknown>): Response =>
  new Response(JSON.stringify({ model: 'image-combo', data: [entry] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('HttpNineRouterService', () => {
  it('returns the assistant message and token usage', async () => {
    const { fetch } = recordingFetch([() => chatResponse('answer')]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const response = await service.complete(request);

    expect(response.content).toBe('answer');
    expect(response.inputTokens).toBe(11);
    expect(response.outputTokens).toBe(22);
  });

  it('sends the configured model and key, never a hard-coded one', async () => {
    const { fetch, calls } = recordingFetch([() => chatResponse('answer')]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await service.complete(request);

    const call = calls[0]!;
    expect(call.url).toBe('https://router.test/v1/chat/completions');
    expect(JSON.parse(call.init.body as string)).toMatchObject({ model: 'opus' });
    expect((call.init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test');
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    const { fetch, calls } = recordingFetch([
      () => new Response('busy', { status: 503 }),
      () => chatResponse('recovered'),
    ]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const response = await service.complete(request);

    expect(response.content).toBe('recovered');
    expect(calls).toHaveLength(2);
  });

  it('does not retry an authentication failure', async () => {
    const { fetch, calls } = recordingFetch([() => new Response('nope', { status: 401 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await expect(service.complete(request)).rejects.toBeInstanceOf(AiRouterError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after exhausting the retry budget', async () => {
    const { fetch, calls } = recordingFetch([() => new Response('busy', { status: 500 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await expect(service.complete(request)).rejects.toBeInstanceOf(AiRetriesExhaustedError);
    expect(calls).toHaveLength(config.retry.maxRetries + 1);
  });

  it('reports an exhausted budget as not retryable, so callers do not square it', async () => {
    const { fetch } = recordingFetch([() => new Response('busy', { status: 500 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.complete(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiRetriesExhaustedError);
    expect((error as AiRetriesExhaustedError).retryable).toBe(false);
    expect((error as AiRetriesExhaustedError).code).toBe(ErrorCode.AiRetriesExhausted);
  });

  it('keeps a non-retryable failure as it is, without wrapping', async () => {
    const { fetch } = recordingFetch([() => new Response('nope', { status: 401 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.complete(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiRouterError);
    expect(error).not.toBeInstanceOf(AiRetriesExhaustedError);
  });

  it('surfaces the router own explanation instead of the raw body', async () => {
    const { fetch } = recordingFetch([
      () =>
        new Response(
          JSON.stringify({
            error: { message: "Provider 'groq' does not support image generation" },
          }),
          { status: 400 },
        ),
    ]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.complete(request).catch((caught: unknown) => caught);

    expect((error as AiRouterError).message).toContain('does not support image generation');
    expect((error as AiRouterError).details['reason']).toContain("Provider 'groq'");
  });

  it('falls back to a short excerpt when a gateway answers with an HTML page', async () => {
    const html = `<!DOCTYPE html><html><head><title>502: Bad gateway</title></head>${'x'.repeat(2000)}`;
    const { fetch } = recordingFetch([() => new Response(html, { status: 400 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.complete(request).catch((caught: unknown) => caught);
    const body = (error as AiRouterError).details['body'];

    expect(typeof body).toBe('string');
    expect((body as string).length).toBeLessThanOrEqual(200);
  });

  it('maps a connection that dies mid-body onto a retryable failure', async () => {
    const dying = (): Response =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('other side closed'));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const { fetch } = recordingFetch([dying]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.complete(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiRetriesExhaustedError);
    expect(causeCode(error)).toBe(ErrorCode.AiRequestFailed);
  });

  it('parses JSON that the model wrapped in a code fence', async () => {
    const { fetch } = recordingFetch([() => chatResponse('```json\n{"title":"ok"}\n```')]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await expect(service.completeJson(request)).resolves.toEqual({ title: 'ok' });
  });

  it('rejects an answer that is not JSON', async () => {
    const { fetch } = recordingFetch([() => chatResponse('sorry, I cannot do that')]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await expect(service.completeJson(request)).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('reports an empty completion instead of returning it', async () => {
    const { fetch } = recordingFetch([
      () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    // An empty completion is worth re-sampling, so it is retried; what the
    // caller finally sees is the exhausted budget, with the cause preserved.
    const error = await service.complete(request).catch((caught: unknown) => caught);

    expect(causeCode(error)).toBe(ErrorCode.AiInvalidResponse);
  });
});

describe('HttpNineRouterService.generateImage', () => {
  const imageRequest = { prompt: 'a lighthouse at dusk', width: 1024, height: 1792 } as const;

  it('returns the decoded bytes of an inline image', async () => {
    const { fetch } = recordingFetch([() => imageResponse({ b64_json: PNG_BASE64 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const image = await service.generateImage(imageRequest);

    expect(image.data.byteLength).toBe(Buffer.from(PNG_BASE64, 'base64').byteLength);
    expect(image.mimeType).toBe('image/png');
    expect(image.combo).toBe('image-combo');
  });

  it('sends the configured image combo, never a provider name', async () => {
    const { fetch, calls } = recordingFetch([() => imageResponse({ b64_json: PNG_BASE64 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await service.generateImage(imageRequest);

    const call = calls[0]!;
    expect(call.url).toBe('https://router.test/v1/images/generations');
    expect(JSON.parse(call.init.body as string)).toMatchObject({
      model: 'image-combo',
      prompt: 'a lighthouse at dusk',
      size: '1024x1792',
    });
  });

  it('sends the prompt untouched', async () => {
    const { fetch, calls } = recordingFetch([() => imageResponse({ b64_json: PNG_BASE64 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);
    const prompt = 'A very specific brief. Avoid: text, logos.';

    await service.generateImage({ ...imageRequest, prompt });

    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ prompt });
  });

  it('downloads an image the router chose to host', async () => {
    const { fetch, calls } = recordingFetch([
      () => imageResponse({ url: 'https://cdn.test/image.png' }),
      () =>
        new Response(Buffer.from(PNG_BASE64, 'base64'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const image = await service.generateImage(imageRequest);

    expect(calls[1]?.url).toBe('https://cdn.test/image.png');
    expect(image.data.byteLength).toBeGreaterThan(0);
  });

  it('retries a rate limit and succeeds on a later attempt', async () => {
    const { fetch, calls } = recordingFetch([
      () => new Response('slow down', { status: 429 }),
      () => imageResponse({ b64_json: PNG_BASE64 }),
    ]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await expect(service.generateImage(imageRequest)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a rejected request', async () => {
    const { fetch, calls } = recordingFetch([() => new Response('bad prompt', { status: 400 })]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    await expect(service.generateImage(imageRequest)).rejects.toBeInstanceOf(AiRouterError);
    expect(calls).toHaveLength(1);
  });

  it('reports an answer that carries neither bytes nor a URL', async () => {
    const { fetch } = recordingFetch([() => imageResponse({})]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.generateImage(imageRequest).catch((caught: unknown) => caught);

    expect(causeCode(error)).toBe(ErrorCode.AiInvalidResponse);
  });

  it('reports an answer that contains no image at all', async () => {
    const { fetch } = recordingFetch([
      () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ]);
    const service = new HttpNineRouterService(config, new NoopLogger(), fetch);

    const error = await service.generateImage(imageRequest).catch((caught: unknown) => caught);

    expect(causeCode(error)).toBe(ErrorCode.AiInvalidResponse);
  });
});
