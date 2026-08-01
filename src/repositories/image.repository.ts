import type { SceneImage as SceneImageRecord } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import type { ImageDto } from '../dto/image.dto.js';

/** Input accepted by {@link ImageRepository.save}. */
export interface NewSceneImageDto {
  readonly contentId: string;
  readonly workflowRunId: string | null;
  readonly sceneNumber: number;
  readonly fileName: string;
  readonly relativePath: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly generationDurationMs: number;
  readonly combo: string;
  /** The assembled prompt, kept so the image can be reproduced. */
  readonly prompt: string;
}

/** A persisted image metadata row. */
export interface SceneImageDto extends NewSceneImageDto {
  readonly id: string;
  readonly createdAt: Date;
}

/** Maps a database row onto the domain DTO. */
const toDto = (record: SceneImageRecord): SceneImageDto => ({
  id: record.id,
  contentId: record.contentId,
  workflowRunId: record.workflowRunId,
  sceneNumber: record.sceneNumber,
  fileName: record.fileName,
  relativePath: record.relativePath,
  byteSize: record.byteSize,
  width: record.width,
  height: record.height,
  generationDurationMs: record.generationDurationMs,
  combo: record.combo,
  prompt: record.prompt,
  createdAt: record.createdAt,
});

/**
 * Persistence for generated image metadata.
 *
 * Tables
 * - `scene_images`
 *
 * Methods
 * - {@link save}
 * - {@link findByContentId}
 * - {@link deleteByContentId}
 *
 * What is stored is where the file was, what produced it and what it cost —
 * never the bytes. Media stays disposable; the record of how it was made is
 * knowledge and survives the cleanup that deletes the file
 * (CLAUDE.md "Metadata").
 *
 * `(content_id, scene_number)` is unique, so {@link save} is an upsert: a
 * regenerated scene replaces its own row rather than accumulating history the
 * pipeline would then have to disambiguate.
 */
export class ImageRepository {
  constructor(private readonly database: Database) {}

  /** Records one generated image, replacing any previous take of that scene. */
  public async save(input: NewSceneImageDto): Promise<SceneImageDto> {
    const values = {
      workflowRunId: input.workflowRunId,
      fileName: input.fileName,
      relativePath: input.relativePath,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      generationDurationMs: input.generationDurationMs,
      combo: input.combo,
      prompt: input.prompt,
    };

    const record = await runQuery('ImageRepository.save', () =>
      this.database.sceneImage.upsert({
        where: {
          contentId_sceneNumber: {
            contentId: input.contentId,
            sceneNumber: input.sceneNumber,
          },
        },
        create: {
          contentId: input.contentId,
          sceneNumber: input.sceneNumber,
          ...values,
        },
        update: values,
      }),
    );

    return toDto(record);
  }

  /** Returns every recorded image for a piece of content, in scene order. */
  public async findByContentId(contentId: string): Promise<readonly SceneImageDto[]> {
    const records = await runQuery('ImageRepository.findByContentId', () =>
      this.database.sceneImage.findMany({
        where: { contentId },
        orderBy: { sceneNumber: 'asc' },
      }),
    );

    return records.map(toDto);
  }

  /** Removes every image record for a piece of content. Returns how many. */
  public async deleteByContentId(contentId: string): Promise<number> {
    const result = await runQuery('ImageRepository.deleteByContentId', () =>
      this.database.sceneImage.deleteMany({ where: { contentId } }),
    );

    return result.count;
  }
}

/** Builds the persistence input from what the Image Agent produced. */
export const toNewSceneImage = (
  image: ImageDto,
  contentId: string,
  workflowRunId: string | null,
  prompt: string,
): NewSceneImageDto => ({
  contentId,
  workflowRunId,
  sceneNumber: image.scene,
  fileName: image.fileName,
  relativePath: image.relativePath,
  byteSize: image.byteSize,
  width: image.width,
  height: image.height,
  generationDurationMs: image.generationDurationMs,
  combo: image.combo,
  prompt,
});
