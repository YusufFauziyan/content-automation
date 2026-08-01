import type { KokoroConfig } from '../config/app.config.js';
import { isApplicationError } from '../types/errors/application.error.js';
import {
  SpeechInvalidResponseError,
  SpeechRetriesExhaustedError,
  SpeechServiceError,
  SpeechTimeoutError,
} from '../types/errors/speech.error.js';
import type { Logger } from '../types/logger.js';
import { sleep } from '../utils/retry/sleep.js';

/** One narration to synthesise. The voice and model are never part of this DTO. */
export interface SpeechRequest {
  /** Exactly the words to speak, already normalised by the caller. */
  readonly text: string;
}

/** Raw bytes of one narration track, still in memory. */
export interface SpeechResponse {
  readonly data: Uint8Array;
  readonly mimeType: string;
  /** Voice preset the server used, recorded alongside the audio metadata. */
  readonly voice: string;
  readonly model: string;
  readonly speed: number;
}

/**
 * Contract for text-to-speech.
 *
 * External system: the Kokoro server, behind its OpenAI-compatible
 * `/audio/speech` endpoint.
 *
 * The service transports text and returns audio. It never decides what to say,
 * never splits the narration and never writes a file — those belong to the
 * Narration Planner Agent, the Voice Agent and `WorkingDirectoryService`
 * respectively.
 */
export interface KokoroService {
  /**
   * Synthesises one narration track.
   *
   * @throws {SpeechRetriesExhaustedError} When the retry budget is used up.
   */
  synthesize(request: SpeechRequest): Promise<SpeechResponse>;
}

/** The subset of `fetch` this service needs. Injectable so tests never use the network. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/** HTTP statuses that are worth another attempt. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Audio format requested from the server, and the type the bytes are labelled with. */
const AUDIO_FORMAT = 'mp3';
const AUDIO_MIME_TYPE = 'audio/mpeg';

/**
 * Smallest response worth treating as audio.
 *
 * A server that answers `200` with a handful of bytes has not produced speech,
 * and writing that to disk would leave a file the composer discovers is empty
 * long after the run that could have retried it.
 */
const MINIMUM_AUDIO_BYTES = 1024;

/**
 * Reads a response body, mapping a mid-transfer failure onto a typed error.
 *
 * Getting a `200` only means the headers arrived. A server that dies while
 * streaming — or a connection the other side closes — fails here, after the
 * status looked fine, and that failure is every bit as retryable as one during
 * the request. Left unwrapped it escapes as an untyped exception and takes the
 * whole run down instead of costing one attempt.
 */
const readBody = async <TResult>(what: string, read: () => Promise<TResult>): Promise<TResult> => {
  try {
    return await read();
  } catch (error) {
    throw new SpeechServiceError(`Kokoro connection failed while reading the ${what}.`, true, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

/** Lifts a server's own explanation out of an error body. */
const describeFailure = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    const detail =
      (parsed as { error?: { message?: unknown }; detail?: unknown }).error?.message ??
      (parsed as { detail?: unknown }).detail;

    return typeof detail === 'string' && detail.trim() !== '' ? detail.slice(0, 300) : null;
  } catch {
    return null;
  }
};

/**
 * HTTP implementation of {@link KokoroService}.
 *
 * Everything variable — endpoint, model, voice, speed, timeout, retry budget —
 * arrives through {@link KokoroConfig}, so changing the narrator's voice is an
 * `.env` change and touches no source file.
 *
 * Retries and their exhaustion behave exactly as the router's do: the budget is
 * configured once, and an error that survives it is reported as non-retryable
 * so the workflow does not multiply it.
 */
export class HttpKokoroService implements KokoroService {
  constructor(
    private readonly config: KokoroConfig,
    private readonly logger: Logger,
    private readonly httpFetch: HttpFetch = globalThis.fetch.bind(globalThis),
  ) {}

  public async synthesize(request: SpeechRequest): Promise<SpeechResponse> {
    const maxAttempts = this.config.retry.maxRetries + 1;
    let lastError: unknown;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsMade = attempt;

      try {
        return await this.sendOnce(request);
      } catch (error) {
        lastError = error;

        if (!isApplicationError(error) || !error.retryable || attempt === maxAttempts) {
          break;
        }

        const delayMs = this.delayForRetry(attempt);
        this.logger.warn('Kokoro call failed, retrying', {
          source: HttpKokoroService.name,
          retryCount: attempt,
          delayMs,
        });
        await sleep(delayMs);
      }
    }

    if (isApplicationError(lastError) && lastError.retryable) {
      throw new SpeechRetriesExhaustedError(attemptsMade, lastError);
    }

    throw lastError;
  }

  /** Performs exactly one synthesis call, mapping every failure onto a typed error. */
  private async sendOnce(request: SpeechRequest): Promise<SpeechResponse> {
    let response: Response;

    try {
      response = await this.httpFetch(`${this.config.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          voice: this.config.voice,
          speed: this.config.speed,
          input: request.text,
          response_format: AUDIO_FORMAT,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new SpeechTimeoutError(this.config.timeoutMs);
      }
      throw new SpeechServiceError('Kokoro is unreachable.', true, {
        reason: error instanceof Error ? error.message : String(error),
        baseUrl: this.config.baseUrl,
      });
    }

    if (!response.ok) {
      const body = await readBody('error body', () => response.text());
      const reported = describeFailure(body);

      throw new SpeechServiceError(
        `Kokoro responded with status ${String(response.status)}${reported === null ? '.' : `: ${reported}`}`,
        RETRYABLE_STATUSES.has(response.status),
        {
          status: response.status,
          ...(reported === null ? { body: body.slice(0, 200) } : { reason: reported }),
        },
      );
    }

    const data = await readBody('audio', async () => new Uint8Array(await response.arrayBuffer()));

    if (data.byteLength < MINIMUM_AUDIO_BYTES) {
      throw new SpeechInvalidResponseError('Kokoro returned too little data to be audio.', {
        byteSize: data.byteLength,
      });
    }

    return {
      data,
      mimeType: response.headers.get('content-type') ?? AUDIO_MIME_TYPE,
      voice: this.config.voice,
      model: this.config.model,
      speed: this.config.speed,
    };
  }

  /** Backoff for the given 1-based retry number, reusing the last delay if needed. */
  private delayForRetry(retryNumber: number): number {
    const { backoffMs } = this.config.retry;
    return backoffMs[retryNumber - 1] ?? backoffMs[backoffMs.length - 1] ?? 0;
  }
}
