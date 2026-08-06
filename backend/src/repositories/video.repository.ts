import type { RenderedVideo as RenderedVideoRecord } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import type { VideoDto } from '../dto/video.dto.js';

/** Input accepted by {@link VideoRepository.save}. */
export interface NewRenderedVideoDto {
  readonly contentId: string;
  readonly workflowRunId: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly renderDurationMs: number;
}

/** A persisted video metadata row. */
export interface RenderedVideoDto extends NewRenderedVideoDto {
  readonly id: string;
  readonly createdAt: Date;
}

/** Maps a database row onto the domain DTO. */
const toDto = (record: RenderedVideoRecord): RenderedVideoDto => ({
  id: record.id,
  contentId: record.contentId,
  workflowRunId: record.workflowRunId ?? '',
  fileName: record.fileName,
  relativePath: record.relativePath,
  byteSize: record.byteSize,
  width: record.width,
  height: record.height,
  fps: record.fps,
  durationMs: record.durationMs,
  videoCodec: record.videoCodec,
  audioCodec: record.audioCodec,
  renderDurationMs: record.renderDurationMs,
  createdAt: record.createdAt,
});

/**
 * Persistence for rendered video metadata.
 *
 * Tables
 * - `rendered_videos`
 *
 * Methods
 * - {@link save}
 * - {@link findByContentId}
 * - {@link deleteByContentId}
 *
 * What is stored is how long the video is, what shape it is, what encoded it
 * and what that cost — never the container. Media stays disposable; the record
 * of what was produced survives the cleanup that deletes the file
 * (CLAUDE.md "Metadata").
 *
 * `(content_id, workflow_run_id)` is unique, so {@link save} is an upsert: a
 * re-rendered run replaces its own row instead of accumulating takes.
 */
export class VideoRepository {
  constructor(private readonly database: Database) {}

  /** Records one rendered video, replacing any previous take of that run. */
  public async save(input: NewRenderedVideoDto): Promise<RenderedVideoDto> {
    const values = {
      fileName: input.fileName,
      relativePath: input.relativePath,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      fps: input.fps,
      durationMs: input.durationMs,
      videoCodec: input.videoCodec,
      audioCodec: input.audioCodec,
      renderDurationMs: input.renderDurationMs,
    };

    const record = await runQuery('VideoRepository.save', () =>
      this.database.renderedVideo.upsert({
        where: {
          contentId_workflowRunId: {
            contentId: input.contentId,
            workflowRunId: input.workflowRunId,
          },
        },
        create: {
          contentId: input.contentId,
          workflowRunId: input.workflowRunId,
          ...values,
        },
        update: values,
      }),
    );

    return toDto(record);
  }

  /** Returns every recorded render for a piece of content, newest first. */
  public async findByContentId(contentId: string): Promise<readonly RenderedVideoDto[]> {
    const records = await runQuery('VideoRepository.findByContentId', () =>
      this.database.renderedVideo.findMany({
        where: { contentId },
        orderBy: { createdAt: 'desc' },
      }),
    );

    return records.map(toDto);
  }

  /** Removes every render record for a piece of content. Returns how many. */
  public async deleteByContentId(contentId: string): Promise<number> {
    const result = await runQuery('VideoRepository.deleteByContentId', () =>
      this.database.renderedVideo.deleteMany({ where: { contentId } }),
    );

    return result.count;
  }
}

/** Builds the persistence input from what the composer produced. */
export const toNewRenderedVideo = (
  video: VideoDto,
  contentId: string,
  workflowRunId: string,
): NewRenderedVideoDto => ({
  contentId,
  workflowRunId,
  fileName: video.fileName,
  relativePath: video.relativePath,
  byteSize: video.byteSize,
  width: video.width,
  height: video.height,
  fps: video.fps,
  durationMs: video.durationMs,
  videoCodec: video.videoCodec,
  audioCodec: video.audioCodec,
  renderDurationMs: video.renderDurationMs,
});
