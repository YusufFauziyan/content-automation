import { describe, expect, it } from 'vitest';

import type { SubtitleCueDto } from '../../../src/dto/subtitle.dto.js';
import { SrtSubtitleService, toSrtTimestamp } from '../../../src/services/subtitle.service.js';

const cue = (index: number, startMs: number, endMs: number, lines: string[]): SubtitleCueDto => ({
  index,
  startMs,
  endMs,
  lines,
});

describe('toSrtTimestamp', () => {
  it('formats the start of the file', () => {
    expect(toSrtTimestamp(0)).toBe('00:00:00,000');
  });

  it('uses a comma before the milliseconds, as SubRip requires', () => {
    expect(toSrtTimestamp(3800)).toBe('00:00:03,800');
  });

  it('carries seconds into minutes and hours', () => {
    expect(toSrtTimestamp(3_723_456)).toBe('01:02:03,456');
  });

  it('pads every field to a fixed width', () => {
    expect(toSrtTimestamp(1)).toBe('00:00:00,001');
  });

  it('never emits a negative time', () => {
    expect(toSrtTimestamp(-500)).toBe('00:00:00,000');
  });
});

describe('SrtSubtitleService', () => {
  it('renders the format players expect', () => {
    const document = new SrtSubtitleService().render([
      cue(1, 0, 3800, ['Artificial Intelligence', 'is changing programming forever.']),
      cue(2, 4100, 6800, ['Developers who embrace AI', 'will work much faster.']),
    ]);

    expect(document).toBe(
      [
        '1',
        '00:00:00,000 --> 00:00:03,800',
        'Artificial Intelligence',
        'is changing programming forever.',
        '',
        '2',
        '00:00:04,100 --> 00:00:06,800',
        'Developers who embrace AI',
        'will work much faster.',
        '',
      ].join('\n'),
    );
  });

  it('separates cues with a blank line', () => {
    const document = new SrtSubtitleService().render([
      cue(1, 0, 1000, ['One']),
      cue(2, 1000, 2000, ['Two']),
    ]);

    expect(document).toContain('One\n\n2\n');
  });

  it('ends the file with a newline', () => {
    expect(new SrtSubtitleService().render([cue(1, 0, 1000, ['One'])]).endsWith('\n')).toBe(true);
  });

  it('renders a single-line cue without padding it', () => {
    expect(new SrtSubtitleService().render([cue(1, 0, 1000, ['Only one line'])])).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\nOnly one line\n',
    );
  });

  it('produces nothing for an empty cue list', () => {
    expect(new SrtSubtitleService().render([])).toBe('');
  });
});
