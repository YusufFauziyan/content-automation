import type { NarrationBlockDto, NarrationPlanDto } from '../dto/narration.dto.js';
import type { VoiceDto, VoiceGenerationResponseDto, VoiceRequestDto } from '../dto/voice.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import type { AudioSegmentDto, FfmpegService } from '../services/ffmpeg.service.js';
import type { KokoroService } from '../services/kokoro.service.js';
import {
  WorkspaceFolder,
  type WorkingDirectoryService,
  type WorkspaceDto,
} from '../services/working-directory.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';

/** The narration track is always this file, in the run's `audio/` folder. */
export const NARRATION_FILE_NAME = 'narration.mp3';

/** One synthesised block: how long it really is, and what produced it. */
interface SpokenClip {
  readonly durationMs: number;
  readonly voice: string;
  readonly model: string;
  readonly speed: number;
}

/** Width of the zero-padded block number in an intermediate file name. */
const BLOCK_NUMBER_DIGITS = 3;

const MILLISECONDS_PER_SECOND = 1000;

/** Durations are carried in seconds but compared in whole milliseconds. */
const toSeconds = (milliseconds: number): number =>
  Math.round(milliseconds) / MILLISECONDS_PER_SECOND;

const toMilliseconds = (seconds: number): number => Math.round(seconds * MILLISECONDS_PER_SECOND);

/**
 * File name for one block's audio, e.g. `block-001.mp3`.
 *
 * These are intermediates — they exist so each block can be measured on its own
 * — and they are disposed of with the rest of the workspace. Keeping them named
 * and in order makes a mis-timed caption traceable to the exact clip that
 * caused it.
 */
export const toBlockFileName = (blockId: number): string =>
  `block-${String(blockId).padStart(BLOCK_NUMBER_DIGITS, '0')}.mp3`;

/**
 * Replaces each block's predicted length with the length its clip really is.
 *
 * The field keeps the name `estimatedDuration` because it is the planner's
 * field; after this it holds a measurement.
 */
export const toMeasuredBlocks = (
  blocks: readonly NarrationBlockDto[],
  measuredDurationsMs: readonly number[],
): readonly NarrationBlockDto[] =>
  blocks.map((block, index) => ({
    ...block,
    estimatedDuration: toSeconds(measuredDurationsMs[index] ?? 0),
  }));

/**
 * Length of the timeline the blocks describe: every clip, plus the silence
 * inserted after it.
 *
 * This — not the length ffprobe reports for the assembled file — is what the
 * subtitles are timed against. The two agree to within an MP3 frame, and using
 * the same arithmetic on both sides means the last caption cannot land past the
 * end of the audio because of a rounding difference.
 */
export const toTimelineLength = (blocks: readonly NarrationBlockDto[]): number =>
  toSeconds(
    blocks.reduce(
      (total, block) =>
        total + toMilliseconds(block.estimatedDuration) + toMilliseconds(block.pauseAfter),
      0,
    ),
  );

/**
 * Speaks a narration plan and measures what came out.
 *
 * Purpose
 * - Produce `narration.mp3`, and replace the plan's estimated block durations
 *   with the real ones.
 *
 * Input
 * - {@link VoiceRequestDto}
 *
 * Output
 * - {@link VoiceGenerationResponseDto}, carrying the measured plan.
 *
 * Dependencies
 * - `KokoroService` — synthesises each block.
 * - `FfmpegService` — measures each clip and joins them with exact silence.
 * - `WorkingDirectoryService` — owns the run's directory and writes the files.
 * - `ContentRepository` — persists the measured plan.
 *
 * Blocks are synthesised **separately** and joined here rather than sent as one
 * request. One request is cheaper, but then the only thing anybody knows is how
 * long the whole file is: the pauses are whatever the engine felt like taking,
 * and subtitle timing built on the *planned* durations drifts further out of
 * sync with every block. Measuring each clip and inserting the planned silence
 * ourselves makes the audio and the captions the same timeline by construction.
 *
 * The agent never writes the narration: it speaks exactly the blocks the
 * Narration Planner Agent decided on.
 */
export class VoiceAgent implements Agent<VoiceRequestDto, VoiceGenerationResponseDto> {
  public readonly name = 'VoiceAgent';

  constructor(
    private readonly kokoro: KokoroService,
    private readonly ffmpeg: FfmpegService,
    private readonly workingDirectory: WorkingDirectoryService,
    private readonly contentRepository: ContentRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(input: VoiceRequestDto): Promise<Result<VoiceGenerationResponseDto>> {
    const logger = this.logger.child({
      source: this.name,
      correlationId: input.correlationId,
      workflowRunId: input.workflowId,
      step: WorkflowStepName.Voice,
    });
    const startedAt = Date.now();
    logger.info('START', { blockCount: input.plan.blocks.length });

    try {
      const spoken = input.plan.blocks.filter((block) => block.text.trim() !== '');

      if (spoken.length === 0) {
        throw new AgentOutputInvalidError(this.name, 'the narration plan contains no words');
      }

      const workspace = await this.workingDirectory.prepare(input.workflowId);
      const clips = await this.speakBlocks(spoken, workspace, logger);

      const narrationPath = this.workingDirectory.resolve(
        workspace,
        WorkspaceFolder.Audio,
        NARRATION_FILE_NAME,
      );
      await this.ffmpeg.concatAudio(this.toSegments(spoken, workspace), narrationPath);

      const stored = await this.workingDirectory.describe(
        workspace,
        WorkspaceFolder.Audio,
        NARRATION_FILE_NAME,
      );
      const assembled = await this.ffmpeg.probe(narrationPath);

      const blocks = toMeasuredBlocks(
        spoken,
        clips.map((clip) => clip.durationMs),
      );
      const settings = clips[clips.length - 1];
      await this.contentRepository.update(input.contentId, { narrationBlocks: blocks });

      const plan: NarrationPlanDto = {
        contentId: input.plan.contentId,
        blocks,
        totalDurationSeconds: toTimelineLength(blocks),
      };

      const generationDurationMs = Date.now() - startedAt;
      const audio: VoiceDto = {
        fileName: stored.fileName,
        relativePath: stored.relativePath,
        absolutePath: stored.absolutePath,
        byteSize: stored.byteSize,
        mimeType: 'audio/mpeg',
        durationSeconds: plan.totalDurationSeconds,
        voice: settings?.voice ?? '',
        model: settings?.model ?? '',
        speed: settings?.speed ?? 1,
        generationDurationMs,
      };

      logger.info('SUCCESS', {
        durationMs: generationDurationMs,
        fileName: audio.fileName,
        byteSize: audio.byteSize,
        blockCount: blocks.length,
        // Three lengths worth telling apart: what the planner predicted, what
        // the timeline the subtitles use adds up to, and what the file on disk
        // measures. The last two drifting apart means the assembly is wrong.
        plannedDurationSeconds: input.plan.totalDurationSeconds,
        timelineDurationSeconds: plan.totalDurationSeconds,
        assembledDurationSeconds: toSeconds(assembled.durationMs),
      });

      return ok({
        contentId: input.contentId,
        workflowId: input.workflowId,
        audioDirectory: workspace.folders[WorkspaceFolder.Audio],
        audio,
        plan,
      });
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /**
   * Synthesises every block, measures each clip, and reports what produced it.
   *
   * Sequential on purpose: the blocks share one speech server, and firing them
   * concurrently turns a retryable rate limit into a failed step for the whole
   * narration at once.
   */
  private async speakBlocks(
    blocks: readonly NarrationBlockDto[],
    workspace: WorkspaceDto,
    logger: Logger,
  ): Promise<readonly SpokenClip[]> {
    const clips: SpokenClip[] = [];

    for (const block of blocks) {
      const spoken = await this.kokoro.synthesize({ text: block.text });
      const stored = await this.workingDirectory.write(
        workspace,
        WorkspaceFolder.Audio,
        toBlockFileName(block.id),
        spoken.data,
      );
      const probed = await this.ffmpeg.probe(stored.absolutePath);

      logger.debug('Block spoken', {
        block: block.id,
        measuredMs: probed.durationMs,
        estimatedMs: Math.round(block.estimatedDuration * MILLISECONDS_PER_SECOND),
      });

      clips.push({
        durationMs: probed.durationMs,
        voice: spoken.voice,
        model: spoken.model,
        speed: spoken.speed,
      });
    }

    return clips;
  }

  /** Interleaves the spoken clips with the silence the plan asks for. */
  private toSegments(
    blocks: readonly NarrationBlockDto[],
    workspace: WorkspaceDto,
  ): readonly AudioSegmentDto[] {
    const segments: AudioSegmentDto[] = [];

    for (const block of blocks) {
      segments.push({
        kind: 'speech',
        path: this.workingDirectory.resolve(
          workspace,
          WorkspaceFolder.Audio,
          toBlockFileName(block.id),
        ),
      });

      if (block.pauseAfter > 0) {
        segments.push({ kind: 'silence', seconds: block.pauseAfter });
      }
    }

    return segments;
  }
}
