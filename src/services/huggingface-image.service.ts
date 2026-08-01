import type { AiImageRequest, AiImageResponse, HttpFetch } from './nine-router.service.js';
import type { HuggingFaceConfig } from '../config/app.config.js';
import { isApplicationError } from '../types/errors/application.error.js';
import {
  ImageProviderError,
  ImageProviderInvalidResponseError,
  ImageProviderRetriesExhaustedError,
  ImageProviderTimeoutError,
} from '../types/errors/image-provider.error.js';
import type { Logger } from '../types/logger.js';
import { sleep } from '../utils/retry/sleep.js';

/**
 * Contract for the Hugging Face Inference Providers image API.
 *
 * External system: the inference router configured through
 * `HUGGINGFACE_BASE_URL`, which forwards to whichever provider serves the
 * configured model.
 *
 * The service transports a prompt and returns image bytes. It never builds a
 * prompt, never decides when to be called, and never names a model: the route
 * comes from configuration, so the same code serves any provider and model the
 * router exposes.
 *
 * It returns the same {@link AiImageResponse} the router does, so a caller can
 * treat the two interchangeably without knowing which one answered.
 */
export interface HuggingFaceImageService {
  /**
   * Generates one image and returns its bytes.
   *
   * Writing the bytes anywhere is not this service's concern.
   */
  generateImage(request: AiImageRequest): Promise<AiImageResponse>;
}

/** HTTP statuses that are worth another attempt. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Fallback when the provider does not declare a content type for an image. */
const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg';

/**
 * Shape of a provider's image answer.
 *
 * Providers behind the router differ: some answer with JSON naming a hosted
 * file, others stream the bytes straight back. Both are handled, because which
 * one arrives is a property of the configured route and not something the
 * caller should have to know.
 */
interface ProviderImagePayload {
  readonly images?: readonly {
    readonly url?: string;
    readonly b64_json?: string;
  }[];
}

/**
 * Reads a response body, mapping a mid-transfer failure onto a typed error.
 *
 * A `200` only means the headers arrived. A connection that dies while the body
 * is still streaming fails here, after the status looked fine, and that is
 * every bit as retryable as a failure during the request — but only if it is
 * mapped. Unwrapped it escapes as an untyped exception and takes the run down
 * instead of costing one attempt.
 */
const readBody = async <TResult>(what: string, read: () => Promise<TResult>): Promise<TResult> => {
  try {
    return await read();
  } catch (error) {
    throw new ImageProviderError(`The image provider failed while reading the ${what}.`, true, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Lifts the provider's own explanation out of an error body.
 *
 * The router answers a rejected request with `{"error":"..."}` and a provider
 * with `{"detail":[…]}`; either way that text names the exact cause — a
 * deprecated model, a missing field, an exhausted credit balance. A gateway in
 * front answers with an HTML page instead, which explains nothing. Returning
 * `null` for the latter keeps the useful case unpolluted by the useless one.
 */
export const describeProviderFailure = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    const { error, detail } = parsed as { error?: unknown; detail?: unknown };
    const reported = detail ?? error;

    if (reported === undefined || reported === null) {
      return null;
    }

    const message = typeof reported === 'string' ? reported : JSON.stringify(reported);

    return message.trim() === '' ? null : message.slice(0, 300);
  } catch {
    return null;
  }
};

/**
 * HTTP implementation of {@link HuggingFaceImageService}.
 *
 * Everything variable — endpoint, key, model route, timeout, retry budget —
 * arrives through {@link HuggingFaceConfig}.
 *
 * Retries live here rather than in the caller because they are transport
 * concerns: a 429 says "ask again in a moment", not "this image failed".
 */
export class HttpHuggingFaceImageService implements HuggingFaceImageService {
  constructor(
    private readonly config: HuggingFaceConfig,
    private readonly logger: Logger,
    private readonly httpFetch: HttpFetch = globalThis.fetch.bind(globalThis),
  ) {}

  public generateImage(request: AiImageRequest): Promise<AiImageResponse> {
    return this.withRetry('generateImage', () => this.sendImage(request));
  }

  /**
   * Applies the configured retry budget to one provider call.
   *
   * An error that survives the whole budget is re-reported as *not* retryable,
   * for the same reason as in the router: the transport policy is configured
   * once, and letting a caller retry on top of it silently squares the budget.
   */
  private async withRetry<TResult>(
    operation: string,
    attemptOnce: () => Promise<TResult>,
  ): Promise<TResult> {
    const maxAttempts = this.config.retry.maxRetries + 1;
    let lastError: unknown;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsMade = attempt;

      try {
        return await attemptOnce();
      } catch (error) {
        lastError = error;

        if (!isApplicationError(error) || !error.retryable || attempt === maxAttempts) {
          break;
        }

        const delayMs = this.delayForRetry(attempt);
        this.logger.warn('Image provider call failed, retrying', {
          source: HttpHuggingFaceImageService.name,
          operation,
          retryCount: attempt,
          delayMs,
        });
        await sleep(delayMs);
      }
    }

    if (isApplicationError(lastError) && lastError.retryable) {
      throw new ImageProviderRetriesExhaustedError(attemptsMade, lastError);
    }

    throw lastError;
  }

  /**
   * Performs exactly one image call.
   *
   * `prompt` and `image_size` are the router's own field names for a
   * text-to-image task; the older `inputs` field the serverless API used is
   * rejected outright by the providers that serve these models today.
   */
  private async sendImage(request: AiImageRequest): Promise<AiImageResponse> {
    const response = await this.post({
      prompt: request.prompt,
      image_size: { width: request.width, height: request.height },
    });
    const contentType = response.headers.get('content-type') ?? '';

    // A provider that streams the bytes back directly needs no unwrapping.
    if (contentType.startsWith('image/')) {
      return {
        data: await readBody('image', async () => new Uint8Array(await response.arrayBuffer())),
        mimeType: contentType,
        combo: this.config.model,
      };
    }

    const payload = await this.readJson<ProviderImagePayload>(response);
    const entry = payload.images?.[0];

    if (entry === undefined) {
      throw new ImageProviderInvalidResponseError('The image provider returned no image.', {
        model: this.config.model,
      });
    }

    if (entry.b64_json !== undefined && entry.b64_json !== '') {
      return {
        data: Buffer.from(entry.b64_json, 'base64'),
        mimeType: DEFAULT_IMAGE_MIME_TYPE,
        combo: this.config.model,
      };
    }

    if (entry.url !== undefined && entry.url !== '') {
      return { ...(await this.download(entry.url)), combo: this.config.model };
    }

    throw new ImageProviderInvalidResponseError(
      'The image provider entry carried neither bytes nor a URL.',
      { model: this.config.model },
    );
  }

  /** Fetches an image the provider chose to host rather than inline. */
  private async download(url: string): Promise<Omit<AiImageResponse, 'combo'>> {
    const response = await this.send(url, { method: 'GET' });

    return {
      data: await readBody('image', async () => new Uint8Array(await response.arrayBuffer())),
      mimeType: response.headers.get('content-type') ?? DEFAULT_IMAGE_MIME_TYPE,
    };
  }

  /** Sends one authenticated JSON POST to the configured model route. */
  private post(body: unknown): Promise<Response> {
    return this.send(`${this.config.baseUrl}/${this.config.model}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Performs one HTTP call, mapping every failure onto a typed error.
   *
   * The timeout is attached here so that both the provider call and an image
   * download are bounded by the same configured budget.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    let response: Response;

    try {
      response = await this.httpFetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new ImageProviderTimeoutError(this.config.timeoutMs);
      }
      throw new ImageProviderError('The image provider is unreachable.', true, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      const body = await readBody('error body', () => response.text());
      const reported = describeProviderFailure(body);

      throw new ImageProviderError(
        `The image provider responded with status ${String(response.status)}${reported === null ? '.' : `: ${reported}`}`,
        RETRYABLE_STATUSES.has(response.status),
        {
          status: response.status,
          model: this.config.model,
          // The provider's own message when it sent one; otherwise a short
          // excerpt, because a gateway error page is HTML and 500 characters of
          // `<!DOCTYPE html>` buries the one line that matters.
          ...(reported === null ? { body: body.slice(0, 200) } : { reason: reported }),
        },
      );
    }

    return response;
  }

  /** Reads and parses a JSON response body. */
  private async readJson<TPayload>(response: Response): Promise<TPayload> {
    const text = await readBody('response body', () => response.text());

    try {
      return JSON.parse(text) as TPayload;
    } catch {
      throw new ImageProviderInvalidResponseError(
        'The image provider returned a body that is not JSON.',
        { preview: text.slice(0, 200) },
      );
    }
  }

  /** Backoff for the given 1-based retry number, reusing the last delay if needed. */
  private delayForRetry(retryNumber: number): number {
    const { backoffMs } = this.config.retry;
    return backoffMs[retryNumber - 1] ?? backoffMs[backoffMs.length - 1] ?? 0;
  }
}
