import type { SubtitleCueDto } from '../dto/subtitle.dto.js';

/**
 * Contract for forced alignment and transcription.
 *
 * External system: Faster Whisper.
 *
 * The service returns timed cues. Formatting them as SRT, merging short cues
 * and enforcing a maximum line length are Subtitle Agent decisions.
 */
export interface WhisperTranscriptionRequest {
  /** Absolute path of the audio to transcribe. */
  readonly audioPath: string;
  readonly language: string;
  /** Known script text, used to constrain the transcription. */
  readonly referenceText?: string;
}

export interface WhisperService {
  /**
   * Transcribes one audio file into timed cues.
   *
   * @throws {ApplicationError} Marked retryable for transport failures.
   */
  transcribe(request: WhisperTranscriptionRequest): Promise<readonly SubtitleCueDto[]>;
}
