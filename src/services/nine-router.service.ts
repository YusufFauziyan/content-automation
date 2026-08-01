import type { NineRouterConfig } from '../config/app.config.js';
import {
  AiInvalidResponseError,
  AiRetriesExhaustedError,
  AiRouterError,
  AiTimeoutError,
} from '../types/errors/ai-router.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { sleep } from '../utils/retry/sleep.js';

/** Role of one message in a conversation. */
export enum AiMessageRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
}

/** One message sent to the model. */
export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
}

/** A single completion request. The combo is never part of this DTO. */
export interface AiCompletionRequest {
  readonly messages: readonly AiMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/** What the router returned for a completion. */
export interface AiCompletionResponse {
  readonly content: string;
  /** Combo the router actually used. */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** A single image request. The combo is never part of this DTO. */
export interface AiImageRequest {
  /** Fully assembled prompt. The service never edits it. */
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
}

/** Raw bytes of one generated image, still in memory. */
export interface AiImageResponse {
  readonly data: Uint8Array;
  readonly mimeType: string;
  /** Combo the router used, recorded alongside the image metadata. */
  readonly combo: string;
}

/**
 * Contract for the 9 Router.
 *
 * External system: the OpenAI-compatible router configured through
 * `NINE_ROUTER_BASE_URL`.
 *
 * The service transports prompts and returns text, parsed JSON or image bytes.
 * It never builds a prompt, never interprets an answer and never decides what
 * to ask — those are agent responsibilities. It also never names a provider:
 * the combo comes from configuration, so the same code serves any model the
 * router exposes.
 */
export interface NineRouterService {
  /** Sends one completion request and returns the raw text answer. */
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;

  /**
   * Sends one completion request and parses the answer as JSON.
   *
   * @throws {AiInvalidResponseError} When the answer is not parseable JSON.
   */
  completeJson(request: AiCompletionRequest): Promise<unknown>;

  /**
   * Generates one image and returns its bytes.
   *
   * Writing the bytes anywhere is not this service's concern.
   */
  generateImage(request: AiImageRequest): Promise<AiImageResponse>;
}

/** The subset of `fetch` this service needs. Injectable so tests never use the network. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Shape of the router's chat-completion answer. */
interface ChatCompletionPayload {
  readonly model?: string;
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

/**
 * Shape of the router's image answer.
 *
 * Routers differ: some inline the image as base64, others return a URL to it.
 * Both are handled, because which one arrives is a property of the combo and
 * not something the caller should have to know.
 */
interface ImageGenerationPayload {
  readonly model?: string;
  readonly data?: readonly {
    readonly b64_json?: string;
    readonly url?: string;
  }[];
}

/** HTTP statuses that are worth another attempt. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Fallback when the router does not declare a content type for an image. */
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';

/**
 * Reads a response body, mapping a mid-transfer failure onto a typed error.
 *
 * A `200` only means the headers arrived. A connection that dies while the
 * body is still streaming fails here, after the status looked fine, and that
 * is every bit as retryable as a failure during the request — but only if it
 * is mapped. Unwrapped it escapes as an untyped exception and takes the run
 * down instead of costing one attempt.
 */
const readBody = async <TResult>(what: string, read: () => Promise<TResult>): Promise<TResult> => {
  try {
    return await read();
  } catch (error) {
    throw new AiRouterError(`9 Router connection failed while reading the ${what}.`, true, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Lifts the router's own explanation out of an error body.
 *
 * The router answers a rejected request with `{"error":{"message":"..."}}`, and
 * that sentence usually names the exact cause — an unsupported combo, a bad
 * key, a provider that cannot do what was asked. A gateway in front of it
 * answers with an HTML page instead, which explains nothing. Returning `null`
 * for the latter keeps the useful case unpolluted by the useless one.
 */
const describeFailure = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    const message = (parsed as { error?: { message?: unknown } }).error?.message;

    return typeof message === 'string' && message.trim() !== '' ? message.slice(0, 300) : null;
  } catch {
    return null;
  }
};

/**
 * Strips the ```json fences some models wrap their answers in.
 *
 * Doing this in the service rather than in every agent keeps the "give me JSON"
 * contract honest at the one boundary where the raw text exists.
 */
const unwrapJsonFence = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);

  return fenced?.[1] ?? trimmed;
};

/**
 * HTTP implementation of {@link NineRouterService}.
 *
 * Everything variable — endpoint, key, combo aliases, timeout, retry budget —
 * arrives through {@link NineRouterConfig}.
 *
 * Retries live here rather than in the workflow because they are transport
 * concerns: a 429 says "ask again in a moment", not "this step failed".
 */
export class HttpNineRouterService implements NineRouterService {
  constructor(
    private readonly config: NineRouterConfig,
    private readonly logger: Logger,
    private readonly httpFetch: HttpFetch = globalThis.fetch.bind(globalThis),
  ) {}

  public complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    return this.withRetry('complete', () => this.sendCompletion(request));
  }

  public async completeJson(request: AiCompletionRequest): Promise<unknown> {
    const response = await this.complete(request);
    const payload = unwrapJsonFence(response.content);

    try {
      return JSON.parse(payload) as unknown;
    } catch {
      throw new AiInvalidResponseError('9 Router did not return parseable JSON.', {
        model: response.model,
        preview: payload.slice(0, 200),
      });
    }
  }

  public generateImage(request: AiImageRequest): Promise<AiImageResponse> {
    return this.withRetry('generateImage', () => this.sendImage(request));
  }

  /**
   * Applies the configured retry budget to one router call.
   *
   * The error itself decides whether another attempt is worthwhile: a 429 is,
   * a 401 is not, and only the mapping below knows which is which.
   *
   * An error that survives the whole budget is re-reported as *not* retryable.
   * The transport retry policy is configured once, in `NINE_ROUTER_MAX_RETRIES`;
   * letting the workflow retry the step as well would silently square that
   * budget — four router attempts inside four step attempts is sixteen calls
   * and over a minute of waiting for a failure that was permanent from the
   * first one. Operators who want a longer window raise the budget.
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
        this.logger.warn('9 Router call failed, retrying', {
          source: HttpNineRouterService.name,
          operation,
          retryCount: attempt,
          delayMs,
        });
        await sleep(delayMs);
      }
    }

    if (isApplicationError(lastError) && lastError.retryable) {
      throw new AiRetriesExhaustedError(operation, attemptsMade, lastError);
    }

    throw lastError;
  }

  /** Performs exactly one completion call. */
  private async sendCompletion(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const response = await this.post('/chat/completions', {
      model: this.config.textCombo,
      stream: false,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    });

    const payload = await this.readJson<ChatCompletionPayload>(response);
    const content = payload.choices?.[0]?.message?.content;

    if (content === undefined || content.trim() === '') {
      throw new AiInvalidResponseError('9 Router returned no message content.', {
        model: payload.model ?? this.config.textCombo,
      });
    }

    return {
      content,
      model: payload.model ?? this.config.textCombo,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    };
  }

  /** Performs exactly one image call. */
  private async sendImage(request: AiImageRequest): Promise<AiImageResponse> {
    const response = await this.post('/images/generations', {
      model: this.config.imageCombo,
      prompt: request.prompt,
      n: 1,
      size: `${String(request.width)}x${String(request.height)}`,
      response_format: 'b64_json',
    });

    const payload = await this.readJson<ImageGenerationPayload>(response);
    const entry = payload.data?.[0];

    if (entry === undefined) {
      throw new AiInvalidResponseError('9 Router returned no image.', {
        combo: this.config.imageCombo,
      });
    }

    const combo = payload.model ?? this.config.imageCombo;

    if (entry.b64_json !== undefined && entry.b64_json !== '') {
      return {
        data: Buffer.from(entry.b64_json, 'base64'),
        mimeType: DEFAULT_IMAGE_MIME_TYPE,
        combo,
      };
    }

    if (entry.url !== undefined && entry.url !== '') {
      return { ...(await this.download(entry.url)), combo };
    }

    throw new AiInvalidResponseError('9 Router image entry carried neither bytes nor a URL.', {
      combo,
    });
  }

  /** Fetches an image the router chose to host rather than inline. */
  private async download(url: string): Promise<Omit<AiImageResponse, 'combo'>> {
    const response = await this.send(url, { method: 'GET' });

    return {
      data: await readBody('image', async () => new Uint8Array(await response.arrayBuffer())),
      mimeType: response.headers.get('content-type') ?? DEFAULT_IMAGE_MIME_TYPE,
    };
  }

  /** Sends one authenticated JSON POST to a router path. */
  private post(path: string, body: unknown): Promise<Response> {
    return this.send(`${this.config.baseUrl}${path}`, {
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
   * The timeout is attached here so that both the router call and an image
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
        throw new AiTimeoutError(this.config.timeoutMs);
      }
      throw new AiRouterError('9 Router is unreachable.', true, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      const body = await readBody('error body', () => response.text());
      const reported = describeFailure(body);

      throw new AiRouterError(
        `9 Router responded with status ${String(response.status)}${reported === null ? '.' : `: ${reported}`}`,
        RETRYABLE_STATUSES.has(response.status),
        {
          status: response.status,
          // The router's own message when it sent one; otherwise a short
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
      throw new AiInvalidResponseError('9 Router returned a body that is not JSON.', {
        preview: text.slice(0, 200),
      });
    }
  }

  /** Backoff for the given 1-based retry number, reusing the last delay if needed. */
  private delayForRetry(retryNumber: number): number {
    const { backoffMs } = this.config.retry;
    return backoffMs[retryNumber - 1] ?? backoffMs[backoffMs.length - 1] ?? 0;
  }
}
