import type { UploadPlatform, UploadStatus } from '../types/upload.js';
import type { VideoDto } from './video.dto.js';

/** Input for the Upload Agent. */
export interface UploadRequestDto {
  readonly contentId: string;
  readonly platform: UploadPlatform;
  readonly video: VideoDto;
  /** One line: the video's title. */
  readonly title: string;
  /** The longer text, for platforms that have somewhere to put it. */
  readonly description: string;
  readonly hashtags: readonly string[];
}

/** Input accepted by `UploadRepository.create`. */
export interface NewUploadDto {
  readonly contentId: string;
  readonly platform: UploadPlatform;
  readonly status: UploadStatus;
}

/** Fields written as the publish attempt progresses. */
export interface UploadResultDto {
  readonly status: UploadStatus;
  readonly externalUrl?: string;
  readonly externalId?: string;
  readonly uploadedAt?: Date;
  readonly verifiedAt?: Date;
}

/** A persisted publish attempt. */
export interface UploadDto {
  readonly id: string;
  readonly contentId: string;
  readonly platform: UploadPlatform;
  readonly status: UploadStatus;
  readonly externalUrl: string | null;
  readonly externalId: string | null;
  readonly uploadedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * A publish attempt as the history page reads it.
 *
 * Carries the content's own title and run id so a row can be understood and
 * followed back to the run that made it, without a second request per row.
 */
export interface UploadHistoryDto extends UploadDto {
  readonly title: string;
  /** Null when the run that produced it has since been deleted. */
  readonly workflowRunId: string | null;
}
