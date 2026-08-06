import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';

/** What the Voice Agent records about the track it produced. */
export interface NewNarrationAudioDto {
  readonly contentId: string;
  /**
   * Run whose working directory holds the file.
   *
   * Required, unlike the column: the compound key this upserts on cannot match
   * a null, and the agent that writes here always knows its run.
   */
  readonly workflowRunId: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly voice: string;
  readonly model: string;
  readonly speed: number;
  readonly generationDurationMs: number;
}

export interface NarrationAudioDto extends Omit<NewNarrationAudioDto, 'workflowRunId'> {
  readonly id: string;
  /** Null for rows written before a run id was recorded. */
  readonly workflowRunId: string | null;
  readonly createdAt: Date;
}

interface NarrationAudioRecord {
  id: string;
  contentId: string;
  workflowRunId: string | null;
  fileName: string;
  relativePath: string;
  byteSize: number;
  mimeType: string;
  durationMs: number;
  voice: string;
  model: string;
  speed: number;
  generationDurationMs: number;
  createdAt: Date;
}

const toDto = (record: NarrationAudioRecord): NarrationAudioDto => ({
  id: record.id,
  contentId: record.contentId,
  workflowRunId: record.workflowRunId,
  fileName: record.fileName,
  relativePath: record.relativePath,
  byteSize: record.byteSize,
  mimeType: record.mimeType,
  durationMs: record.durationMs,
  voice: record.voice,
  model: record.model,
  speed: record.speed,
  generationDurationMs: record.generationDurationMs,
  createdAt: record.createdAt,
});

/**
 * Metadata of the narration track a run produced.
 *
 * Table
 * - `narration_audios`
 *
 * Methods
 * - {@link save}, {@link findByContentId}, {@link deleteByContentId}
 *
 * The audio bytes are never stored: they live in the run's working directory
 * until the video is rendered and are deleted afterwards, exactly like the
 * stills. What survives is what the file was, what produced it and what it cost
 * — which is what lets a resumed run continue without speaking the script
 * again.
 */
export class AudioRepository {
  constructor(private readonly database: Database) {}

  /**
   * Records a narration track, replacing whatever that run wrote before.
   *
   * An upsert rather than an insert: re-running the voice step for a run that
   * already has a track is a legitimate thing to do, and it should leave one
   * row describing the file that is actually on disk, not two disagreeing.
   */
  public async save(input: NewNarrationAudioDto): Promise<NarrationAudioDto> {
    const data = {
      fileName: input.fileName,
      relativePath: input.relativePath,
      byteSize: input.byteSize,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      voice: input.voice,
      model: input.model,
      speed: input.speed,
      generationDurationMs: input.generationDurationMs,
    };

    const record = await runQuery('AudioRepository.save', () =>
      this.database.narrationAudio.upsert({
        where: {
          contentId_workflowRunId: {
            contentId: input.contentId,
            workflowRunId: input.workflowRunId,
          },
        },
        create: { contentId: input.contentId, workflowRunId: input.workflowRunId, ...data },
        update: data,
      }),
    );

    return toDto(record);
  }

  /** Every track recorded for a piece of content, newest first. */
  public async findByContentId(contentId: string): Promise<readonly NarrationAudioDto[]> {
    const records = await runQuery('AudioRepository.findByContentId', () =>
      this.database.narrationAudio.findMany({ where: { contentId }, orderBy: { createdAt: 'desc' } }),
    );

    return records.map(toDto);
  }

  /** Removes every track for a piece of content. */
  public async deleteByContentId(contentId: string): Promise<number> {
    const { count } = await runQuery('AudioRepository.deleteByContentId', () =>
      this.database.narrationAudio.deleteMany({ where: { contentId } }),
    );

    return count;
  }
}
