/** One narration to synthesise. The voice and model are never part of this DTO. */
export interface SpeechRequest {
  /** Exactly the words to speak, already normalised by the caller. */
  readonly text: string;
  /**
   * Language to speak it in, e.g. `en`.
   *
   * Carried per request rather than read from configuration, because it is a
   * property of the video being made: two runs on one server can be in two
   * languages. Servers that speak only one ignore it.
   */
  readonly language?: string;
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
 * The service transports text and returns audio. It never decides what to say,
 * never splits the narration and never writes a file — those belong to the
 * Narration Planner Agent, the Voice Agent and `WorkingDirectoryService`
 * respectively.
 *
 * Kept apart from its implementation so the Voice Agent depends on the contract
 * rather than on whichever server happens to speak the words.
 */
export interface SpeechService {
  /**
   * Synthesises one narration track.
   *
   * @throws {SpeechRetriesExhaustedError} When the retry budget is used up.
   */
  synthesize(request: SpeechRequest): Promise<SpeechResponse>;
}
