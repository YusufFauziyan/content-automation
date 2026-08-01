import type { SubtitleCueDto } from '../dto/subtitle.dto.js';

/**
 * Contract for rendering subtitle files.
 *
 * External system: the SubRip (`.srt`) file format.
 *
 * This is a service rather than a utility because the format is somebody
 * else's specification, exactly like an HTTP API: the timestamp punctuation,
 * the blank-line separator and the 1-based numbering are all rules this project
 * must satisfy but does not get to choose. Isolating them here means the agent
 * decides *what* the cues say and *when* they appear, and nothing in the
 * business logic has to know how a comma-separated millisecond is written.
 *
 * It holds no business logic: which words go in a cue and how long it stays on
 * screen are decided before anything reaches this service.
 */
export interface SubtitleService {
  /** Renders cues as the body of a `.srt` file. */
  render(cues: readonly SubtitleCueDto[]): string;
}

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Pads a number to a fixed width, e.g. `7` to `"07"`. */
const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * Formats milliseconds as `HH:MM:SS,mmm`.
 *
 * The comma before the milliseconds is not a typo — SubRip requires it, and a
 * decimal point silently breaks players that parse strictly.
 */
export const toSrtTimestamp = (totalMilliseconds: number): string => {
  const clamped = Math.max(0, Math.round(totalMilliseconds));
  const milliseconds = clamped % MILLISECONDS_PER_SECOND;
  const totalSeconds = Math.floor(clamped / MILLISECONDS_PER_SECOND);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`;
};

/**
 * SubRip implementation of {@link SubtitleService}.
 *
 * Blocks are separated by a blank line and the file ends with a newline, which
 * is what players expect and what makes a diff of two generated files readable.
 */
export class SrtSubtitleService implements SubtitleService {
  public render(cues: readonly SubtitleCueDto[]): string {
    if (cues.length === 0) {
      return '';
    }

    const blocks = cues.map((cue) =>
      [
        String(cue.index),
        `${toSrtTimestamp(cue.startMs)} --> ${toSrtTimestamp(cue.endMs)}`,
        ...cue.lines,
      ].join('\n'),
    );

    return `${blocks.join('\n\n')}\n`;
  }
}
