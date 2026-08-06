import type {
  NewUploadDto,
  UploadDto,
  UploadHistoryDto,
  UploadResultDto,
} from '../dto/upload.dto.js';
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

  /**
   * Opens, or reopens, the attempt for a piece of content on one platform.
   *
   * The table holds one row per destination — `@@unique([contentId, platform])`
   * — because it records where a video *is*, not every time somebody tried.
   * Publishing again is therefore the same row moving, not a second row, and
   * insisting on a new one is what made every retry fail with a constraint
   * violation instead of publishing.
   *
   * What the last attempt learned is left alone: the status moves, the URL and
   * timestamps stay until something replaces them. A retry that dies early must
   * not erase the link a previous success recorded.
   */
  public async open(input: NewUploadDto): Promise<UploadDto> {
    const record = await runQuery('UploadRepository.open', () =>
      this.database.upload.upsert({
        where: {
          contentId_platform: {
            contentId: input.contentId,
            platform: toDbUploadPlatform(input.platform),
          },
        },
        create: {
          contentId: input.contentId,
          platform: toDbUploadPlatform(input.platform),
          status: toDbUploadStatus(input.status),
        },
        update: { status: toDbUploadStatus(input.status) },
      }),
    );

    return toDto(record);
  }

  /** Opens a publish attempt, failing if the destination already has one. */
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

  /**
   * The most recent publish attempts, newest first, with what they published.
   *
   * Joined onto the content so the history reads as titles rather than as
   * identifiers: `external_url` outlives the video file, and a list of URLs
   * with no idea what is behind them is not a history anybody can use.
   *
   * Failed attempts are included. A history that showed only successes would
   * hide the thing an operator most needs to see — that publishing stopped
   * working three days ago.
   */
  public async findRecent(limit: number): Promise<readonly UploadHistoryDto[]> {
    const records = await runQuery('UploadRepository.findRecent', () =>
      this.database.upload.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          content: {
            select: {
              title: true,
              // The run that produced it, newest first: a piece of content can
              // be re-run, and the latest attempt is the one worth linking to.
              runs: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
      }),
    );

    return records.map((record) => ({
      ...toDto(record),
      title: record.content.title,
      workflowRunId: record.content.runs[0]?.id ?? null,
    }));
  }

  /** Every attempt recorded for a piece of content, one per destination. */
  public async findByContentId(contentId: string): Promise<readonly UploadDto[]> {
    const records = await runQuery('UploadRepository.findByContentId', () =>
      this.database.upload.findMany({ where: { contentId }, orderBy: { platform: 'asc' } }),
    );

    return records.map(toDto);
  }

  /** Opens or replaces the attempt recorded for a piece of content. */
  public async upsert(input: NewUploadDto & UploadResultDto): Promise<UploadDto> {
    const data = {
      status: toDbUploadStatus(input.status),
      externalId: input.externalId ?? null,
      externalUrl: input.externalUrl ?? null,
      uploadedAt: input.uploadedAt ?? null,
      verifiedAt: input.verifiedAt ?? null,
    };

    const record = await runQuery('UploadRepository.upsert', () =>
      this.database.upload.upsert({
        where: {
          contentId_platform: {
            contentId: input.contentId,
            platform: toDbUploadPlatform(input.platform),
          },
        },
        create: {
          contentId: input.contentId,
          platform: toDbUploadPlatform(input.platform),
          ...data,
        },
        update: data,
      }),
    );

    return toDto(record);
  }

  /** Removes publish attempts. Returns how many rows went. */
  public async deleteMany(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const { count } = await runQuery('UploadRepository.deleteMany', () =>
      this.database.upload.deleteMany({ where: { id: { in: [...ids] } } }),
    );

    return count;
  }

  /** Removes a publish attempt. */
  public async delete(id: string): Promise<void> {
    await runQuery('UploadRepository.delete', () => this.database.upload.delete({ where: { id } }));
  }
}
