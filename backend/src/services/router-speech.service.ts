import type { RouterSpeechConfig } from '../config/app.config.js';
import type { HttpFetch } from './nine-router.service.js';
import type { SpeechRequest, SpeechResponse, SpeechService } from './speech.service.js';
import { isApplicationError } from '../types/errors/application.error.js';
import {
  SpeechInvalidResponseError,
  SpeechRetriesExhaustedError,
  SpeechServiceError,
  SpeechTimeoutError,
} from '../types/errors/speech.error.js';
import type { Logger } from '../types/logger.js';
import { sleep } from '../utils/retry/sleep.js';

/** HTTP statuses worth another attempt. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Shortest answer that could plausibly be audio rather than an error page. */
const MIN_AUDIO_BYTES = 512;

/**
 * The pace the router reads at.
 *
 * Its endpoint has no rate control: the audio comes back at the voice's natural
 * speed. Named rather than written as a bare `1` because the narration planner
 * divides its duration estimates by it.
 */
export const ROUTER_SPEECH_SPEED = 1;

/**
 * Text to speech through the 9 Router.
 *
 * External system: the router's `/audio/speech` endpoint, which fronts Google's
 * voices as `google-tts/{language}`.
 *
 * Speaks whatever it is given and returns bytes. It never decides what to say,
 * how to split it or how long the result should be — those belong to the
 * Narration Planner and the Voice Agent.
 *
 * One voice per language. The endpoint accepts a `voice` field and ignores it:
 * the same text with `alloy` and with `nova` comes back byte-identical. Sending
 * one anyway would imply a choice that does not exist.
 */
export class RouterSpeechService implements SpeechService {
  constructor(
    private readonly config: RouterSpeechConfig,
    private readonly logger: Logger,
    private readonly httpFetch: HttpFetch = globalThis.fetch.bind(globalThis),
  ) {}

  public synthesize(request: SpeechRequest): Promise<SpeechResponse> {
    return this.withRetry(() => this.speak(request));
  }

  /** Performs exactly one call. */
  private async speak(request: SpeechRequest): Promise<SpeechResponse> {
    // The run's language wins; configuration is the default for callers that
    // do not name one.
    const model = `${this.config.modelPrefix}/${request.language ?? this.config.language}`;
    const response = await this.send(model, request.text);

    const data = await this.read(response);

    if (data.byteLength < MIN_AUDIO_BYTES) {
      throw new SpeechInvalidResponseError('The router returned too little data to be audio.', {
        model,
        byteSize: data.byteLength,
      });
    }

    return {
      data,
      mimeType: response.headers.get('content-type') ?? 'audio/mpeg',
      voice: request.language ?? this.config.language,
      model,
      speed: ROUTER_SPEECH_SPEED,
    };
  }

  private async send(model: string, input: string): Promise<Response> {
    let response: Response;

    try {
      response = await this.httpFetch(`${this.config.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new SpeechTimeoutError(this.config.timeoutMs);
      }
      throw new SpeechServiceError('The speech router is unreachable.', true, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      const body = await this.readText(response);

      throw new SpeechServiceError(
        `The speech router responded with status ${String(response.status)}.`,
        RETRYABLE_STATUSES.has(response.status),
        { status: response.status, model, body: body.slice(0, 200) },
      );
    }

    return response;
  }

  /**
   * A `200` only means the headers arrived. A connection that dies mid-body
   * fails here, and unwrapped it would escape as an untyped exception and take
   * the run down instead of costing one attempt.
   */
  private async read(response: Response): Promise<Uint8Array> {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new SpeechServiceError('The connection failed while reading the audio.', true, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async readText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  /**
   * Applies the configured retry budget.
   *
   * An error that survives it is re-reported as not retryable: the policy has
   * been applied in full, and letting the workflow retry on top would square
   * the operator's budget.
   */
  private async withRetry(attemptOnce: () => Promise<SpeechResponse>): Promise<SpeechResponse> {
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

        const delayMs =
          this.config.retry.backoffMs[attempt - 1] ??
          this.config.retry.backoffMs[this.config.retry.backoffMs.length - 1] ??
          0;

        this.logger.warn('Speech call failed, retrying', {
          source: RouterSpeechService.name,
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
}
