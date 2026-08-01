import type { NewUploadDto, UploadDto, UploadResultDto } from '../dto/upload.dto.js';
import {
  toDbUploadPlatform,
  toDbUploadStatus,
  toUploadPlatform,
  toUploadStatus,
} from '../database/enum.map.js';
import type { Prisma, Upload as UploadRecord } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import type { UploadPlatform } from '../types/upload.js';

/** Maps a database row onto the domain DTO. */
const toDto = (record: UploadRecord): UploadDto => ({
  id: record.id,
  contentId: record.contentId,
  platform: toUploadPlatform(record.platform),
  status: toUploadStatus(record.status),
  externalUrl: record.externalUrl,
  externalId: record.externalId,
  uploadedAt: record.uploadedAt,
  verifiedAt: record.verifiedAt,
  createdAt: record.createdAt,
});

/**
 * Persistence for publish attempts.
 *
 * Tables
 * - `uploads`
 *
 * Methods
 * - {@link create}
 * - {@link findById}
 * - {@link findByContentAndPlatform}
 * - {@link updateResult}
 * - {@link delete}
 *
 * Only the *reference* to the published video is stored. The video file itself
 * is deleted once the upload is verified, which is why `external_url` is the
 * single durable artefact of a successful run.
 */
export class UploadRepository {
  constructor(private readonly database: Database) {}

  /** Opens a publish attempt for a piece of content on one platform. */
  public async create(input: NewUploadDto): Promise<UploadDto> {
    const record = await runQuery('UploadRepository.create', () =>
      this.database.upload.create({
        data: {
          contentId: input.contentId,
          platform: toDbUploadPlatform(input.platform),
          status: toDbUploadStatus(input.status),
        },
      }),
    );

    return toDto(record);
  }

  /** Returns the upload, or `null` when the id is unknown. */
  public async findById(id: string): Promise<UploadDto | null> {
    const record = await runQuery('UploadRepository.findById', () =>
      this.database.upload.findUnique({ where: { id } }),
    );

    return record === null ? null : toDto(record);
  }

  /** Lookup used when resuming a run that may already have published. */
  public async findByContentAndPlatform(
    contentId: string,
    platform: UploadPlatform,
  ): Promise<UploadDto | null> {
    const record = await runQuery('UploadRepository.findByContentAndPlatform', () =>
      this.database.upload.findUnique({
        where: {
          contentId_platform: { contentId, platform: toDbUploadPlatform(platform) },
        },
      }),
    );

    return record === null ? null : toDto(record);
  }

  /**
   * Advances a publish attempt. Fields left out are untouched.
   *
   * Which status transition stamps which timestamp is a business rule and is
   * decided by the Upload Agent, not here.
   */
  public async updateResult(id: string, input: UploadResultDto): Promise<UploadDto> {
    const data: Prisma.UploadUpdateInput = { status: toDbUploadStatus(input.status) };

    if (input.externalUrl !== undefined) {
      data.externalUrl = input.externalUrl;
    }
    if (input.externalId !== undefined) {
      data.externalId = input.externalId;
    }
    if (input.uploadedAt !== undefined) {
      data.uploadedAt = input.uploadedAt;
    }
    if (input.verifiedAt !== undefined) {
      data.verifiedAt = input.verifiedAt;
    }

    const record = await runQuery('UploadRepository.updateResult', () =>
      this.database.upload.update({ where: { id }, data }),
    );

    return toDto(record);
  }

  /** Removes a publish attempt. */
  public async delete(id: string): Promise<void> {
    await runQuery('UploadRepository.delete', () => this.database.upload.delete({ where: { id } }));
  }
}
