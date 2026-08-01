import { describe, expect, it } from 'vitest';

import {
  MAX_LINES_PER_CUE,
  MAX_LINE_LENGTH,
  SubtitleAgent,
  toCues,
  wrapText,
} from '../../../src/agents/subtitle.agent.js';
import {
  NarrationEmphasis,
  type NarrationBlockDto,
  type NarrationPlanDto,
} from '../../../src/dto/narration.dto.js';
import type { SubtitleRequestDto } from '../../../src/dto/subtitle.dto.js';
import { SrtSubtitleService } from '../../../src/services/subtitle.service.js';
import {
  WorkspaceFolder,
  type StoredFileDto,
  type WorkingDirectoryService,
  type WorkspaceDto,
} from '../../../src/services/working-directory.service.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';

const block = (
  id: number,
  text: string,
  estimatedDuration: number,
  pauseAfter: number,
): NarrationBlockDto => ({
  id,
  text,
  estimatedDuration,
  pauseAfter,
  emphasis: NarrationEmphasis.Normal,
});

const plan: NarrationPlanDto = {
  contentId: 'content-1',
  blocks: [
    block(1, 'Artificial Intelligence is changing programming forever.', 3.8, 0.3),
    block(2, 'Developers who embrace AI will work much faster.', 2.7, 0),
  ],
  totalDurationSeconds: 6.8,
};

const request: SubtitleRequestDto = {
  correlationId: 'run-1',
  workflowId: 'workflow-1',
  contentId: 'content-1',
  plan,
};

const workspace: WorkspaceDto = {
  workflowId: 'workflow-1',
  root: '/tmp/out/workflows/workflow-1',
  folders: {
    [WorkspaceFolder.Images]: '/tmp/out/workflows/workflow-1/images',
    [WorkspaceFolder.Audio]: '/tmp/out/workflows/workflow-1/audio',
    [WorkspaceFolder.Subtitle]: '/tmp/out/workflows/workflow-1/subtitle',
    [WorkspaceFolder.Video]: '/tmp/out/workflows/workflow-1/video',
    [WorkspaceFolder.Thumbnail]: '/tmp/out/workflows/workflow-1/thumbnail',
  },
};

const recordingWorkspace = (
  written: { folder: WorkspaceFolder; fileName: string; text: string }[],
): WorkingDirectoryService => ({
  prepare: () => Promise.resolve(workspace),
  write: (_workspace, folder, fileName, data) => {
    written.push({ folder, fileName, text: new TextDecoder().decode(data) });

    return Promise.resolve<StoredFileDto>({
      fileName,
      relativePath: `${folder}/${fileName}`,
      absolutePath: `${workspace.root}/${folder}/${fileName}`,
      byteSize: data.byteLength,
    });
  },
  resolve: (_workspace, folder, fileName) => `${workspace.root}/${folder}/${fileName}`,
  describe: (_workspace, folder, fileName) =>
    Promise.resolve<StoredFileDto>({
      fileName,
      relativePath: `${folder}/${fileName}`,
      absolutePath: `${workspace.root}/${folder}/${fileName}`,
      byteSize: 1024,
    }),
  remove: () => Promise.resolve(),
});

const createAgent = (
  written: { folder: WorkspaceFolder; fileName: string; text: string }[] = [],
): SubtitleAgent =>
  new SubtitleAgent(new SrtSubtitleService(), recordingWorkspace(written), new NoopLogger());

describe('wrapText', () => {
  it('keeps a short line whole', () => {
    expect(wrapText('Short enough', MAX_LINE_LENGTH)).toEqual(['Short enough']);
  });

  it('breaks on word boundaries within the limit', () => {
    const lines = wrapText(
      'Artificial Intelligence is changing programming forever.',
      MAX_LINE_LENGTH,
    );

    expect(lines.every((line) => line.length <= MAX_LINE_LENGTH)).toBe(true);
    expect(lines.join(' ')).toBe('Artificial Intelligence is changing programming forever.');
  });

  it('never splits a word in half', () => {
    const word = 'a'.repeat(MAX_LINE_LENGTH + 20);

    expect(wrapText(word, MAX_LINE_LENGTH)).toEqual([word]);
  });

  it('collapses stray whitespace', () => {
    expect(wrapText('  one   two  ', MAX_LINE_LENGTH)).toEqual(['one two']);
  });
});

describe('toCues', () => {
  it('starts the first cue at zero', () => {
    expect(toCues(plan.blocks)[0]?.startMs).toBe(0);
  });

  it('times a cue from the block estimate', () => {
    const cues = toCues([block(1, 'One short line.', 3.8, 0.3)]);

    expect(cues[0]?.endMs).toBe(3800);
  });

  it('leaves the pause as a gap between cues', () => {
    const cues = toCues(plan.blocks);
    const first = cues[0];
    const second = cues[1];

    // 3.8s of speech, then 0.3s of silence.
    expect(first?.endMs).toBe(3800);
    expect(second?.startMs).toBe(4100);
  });

  it('numbers cues from one, without gaps', () => {
    expect(toCues(plan.blocks).map((cue) => cue.index)).toEqual([1, 2]);
  });

  it('never shows more than two lines at once', () => {
    const long = 'word '.repeat(60).trim();
    const cues = toCues([block(1, long, 20, 0)]);

    expect(cues.every((cue) => cue.lines.length <= MAX_LINES_PER_CUE)).toBe(true);
  });

  it('keeps every line within the readable length', () => {
    const long = 'word '.repeat(60).trim();
    const cues = toCues([block(1, long, 20, 0)]);

    expect(cues.every((cue) => cue.lines.every((line) => line.length <= MAX_LINE_LENGTH))).toBe(
      true,
    );
  });

  it('splits a long block into cues that stay inside its own time', () => {
    const long = 'word '.repeat(60).trim();
    const cues = toCues([block(1, long, 20, 0)]);

    expect(cues.length).toBeGreaterThan(1);
    expect(cues[cues.length - 1]?.endMs).toBe(20000);
  });

  it('never lets one cue start before the previous ends', () => {
    const cues = toCues([
      block(1, 'word '.repeat(40).trim(), 12, 0.4),
      block(2, 'Then this.', 2, 0),
    ]);

    for (let index = 1; index < cues.length; index += 1) {
      expect(cues[index]!.startMs).toBeGreaterThanOrEqual(cues[index - 1]!.endMs);
    }
  });

  it('produces nothing for a plan with no blocks', () => {
    expect(toCues([])).toEqual([]);
  });
});

describe('SubtitleAgent', () => {
  it('writes subtitle.srt into the subtitle folder', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; text: string }[] = [];

    const result = await createAgent(written).execute(request);

    expect(result.success).toBe(true);
    expect(written[0]?.folder).toBe(WorkspaceFolder.Subtitle);
    expect(written[0]?.fileName).toBe('subtitle.srt');
  });

  it('writes the timing the plan implies', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; text: string }[] = [];

    await createAgent(written).execute(request);

    expect(written[0]?.text).toContain('00:00:00,000 --> 00:00:03,800');
    expect(written[0]?.text).toContain('00:00:04,100 --> 00:00:06,800');
  });

  it('reports how many cues it produced and when they end', async () => {
    const result = await createAgent().execute(request);
    const subtitle = result.success ? result.data.subtitle : null;

    expect(subtitle?.cueCount).toBe(2);
    expect(subtitle?.totalDurationMs).toBe(6800);
  });

  it('refuses a plan with no blocks', async () => {
    const written: { folder: WorkspaceFolder; fileName: string; text: string }[] = [];

    const result = await createAgent(written).execute({
      ...request,
      plan: { ...plan, blocks: [] },
    });

    expect(result.success).toBe(false);
    expect(written).toHaveLength(0);
  });
});
