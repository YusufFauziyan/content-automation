import type { NarrationBlockDto } from '../dto/narration.dto.js';
import type {
  SubtitleCueDto,
  SubtitleDto,
  SubtitleGenerationResponseDto,
  SubtitleRequestDto,
} from '../dto/subtitle.dto.js';
import type { SubtitleService } from '../services/subtitle.service.js';
import {
  WorkspaceFolder,
  type WorkingDirectoryService,
} from '../services/working-directory.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';

/** The subtitle track is always this file, in the run's `subtitle/` folder. */
export const SUBTITLE_FILE_NAME = 'subtitle.srt';

/**
 * Readability limits every cue must respect.
 *
 * These are a broadcasting convention rather than a deployment choice — 42
 * characters is about what a viewer reads comfortably in one glance on a phone,
 * and a third line covers the picture. They are named constants rather than
 * configuration because changing them changes what "readable" means, not how
 * this deployment differs from another.
 */
export const MAX_LINE_LENGTH = 42;
export const MAX_LINES_PER_CUE = 2;

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Wraps text into lines no longer than `maxLineLength`, breaking on words.
 *
 * A word longer than the limit is left intact on its own line: hyphenating a
 * URL or a long name mid-token is worse than one over-long line.
 */
export const wrapText = (text: string, maxLineLength: number): readonly string[] => {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;

    if (candidate.length <= maxLineLength) {
      current = candidate;
      continue;
    }

    if (current !== '') {
      lines.push(current);
    }
    current = word;
  }

  if (current !== '') {
    lines.push(current);
  }

  return lines;
};

/**
 * Turns one block into the cues it needs, splitting when it is too long to
 * show at once.
 *
 * The block's time is divided between its cues in proportion to how much text
 * each carries, which keeps a long cue on screen longer than a short one
 * instead of flashing them at equal speed.
 */
const toBlockCues = (
  block: NarrationBlockDto,
  startMs: number,
  firstIndex: number,
): readonly SubtitleCueDto[] => {
  const lines = wrapText(block.text, MAX_LINE_LENGTH);
  const groups: string[][] = [];

  for (let index = 0; index < lines.length; index += MAX_LINES_PER_CUE) {
    groups.push([...lines.slice(index, index + MAX_LINES_PER_CUE)]);
  }

  if (groups.length === 0) {
    return [];
  }

  const durationMs = Math.round(block.estimatedDuration * MILLISECONDS_PER_SECOND);
  const totalCharacters = groups.reduce((sum, group) => sum + group.join(' ').length, 0);
  const cues: SubtitleCueDto[] = [];
  let cursorMs = startMs;

  groups.forEach((group, position) => {
    const share =
      totalCharacters === 0 ? 1 / groups.length : group.join(' ').length / totalCharacters;
    // The last cue absorbs the rounding, so the block ends exactly on time.
    const isLast = position === groups.length - 1;
    const endMs = isLast ? startMs + durationMs : cursorMs + Math.round(durationMs * share);

    cues.push({ index: firstIndex + position, startMs: cursorMs, endMs, lines: group });
    cursorMs = endMs;
  });

  return cues;
};

/**
 * Lays the whole plan out on a timeline.
 *
 * Exported so the timing rule can be tested without a filesystem: a cue starts
 * where the previous block's speech and its pause ended.
 */
export const toCues = (blocks: readonly NarrationBlockDto[]): readonly SubtitleCueDto[] => {
  const cues: SubtitleCueDto[] = [];
  let cursorMs = 0;

  for (const block of blocks) {
    const blockCues = toBlockCues(block, cursorMs, cues.length + 1);
    cues.push(...blockCues);

    cursorMs +=
      Math.round(block.estimatedDuration * MILLISECONDS_PER_SECOND) +
      Math.round(block.pauseAfter * MILLISECONDS_PER_SECOND);
  }

  return cues;
};

/**
 * Renders the narration plan as a subtitle file.
 *
 * Purpose
 * - Decide when each line appears and how it is broken for the screen, then
 *   write the `.srt`.
 *
 * Input
 * - {@link SubtitleRequestDto}
 *
 * Output
 * - {@link SubtitleGenerationResponseDto}
 *
 * Dependencies
 * - `SubtitleService` — renders the SubRip format.
 * - `WorkingDirectoryService` — owns the run's directory and writes the file.
 *
 * Timing comes from the same plan the audio was spoken from, which is why no
 * transcription step is needed to align them (PROJECT_RULES.md forbids
 * inventing work the pipeline already has the answer to). The estimate is only
 * as good as the speaking rate in configuration; the composer will be able to
 * probe the real audio and correct any drift.
 */
export class SubtitleAgent implements Agent<SubtitleRequestDto, SubtitleGenerationResponseDto> {
  public readonly name = 'SubtitleAgent';

  constructor(
    private readonly subtitleService: SubtitleService,
    private readonly workingDirectory: WorkingDirectoryService,
    private readonly logger: Logger,
  ) {}

  public async execute(input: SubtitleRequestDto): Promise<Result<SubtitleGenerationResponseDto>> {
    const logger = this.logger.child({
      source: this.name,
      correlationId: input.correlationId,
      workflowRunId: input.workflowId,
      step: WorkflowStepName.Subtitle,
    });
    const startedAt = Date.now();
    logger.info('START', { blockCount: input.plan.blocks.length });

    try {
      const cues = toCues(input.plan.blocks);

      if (cues.length === 0) {
        throw new AgentOutputInvalidError(this.name, 'the narration plan produced no cues');
      }

      const workspace = await this.workingDirectory.prepare(input.workflowId);
      const document = this.subtitleService.render(cues);

      const stored = await this.workingDirectory.write(
        workspace,
        WorkspaceFolder.Subtitle,
        SUBTITLE_FILE_NAME,
        new TextEncoder().encode(document),
      );

      const subtitle: SubtitleDto = {
        fileName: stored.fileName,
        relativePath: stored.relativePath,
        absolutePath: stored.absolutePath,
        byteSize: stored.byteSize,
        cueCount: cues.length,
        totalDurationMs: cues[cues.length - 1]?.endMs ?? 0,
      };

      logger.info('SUCCESS', {
        durationMs: Date.now() - startedAt,
        cueCount: subtitle.cueCount,
        totalDurationMs: subtitle.totalDurationMs,
      });

      return ok({
        contentId: input.contentId,
        workflowId: input.workflowId,
        subtitleDirectory: workspace.folders[WorkspaceFolder.Subtitle],
        subtitle,
        cues,
      });
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }
}
