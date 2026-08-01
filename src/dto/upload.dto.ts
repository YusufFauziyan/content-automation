import type { UploadPlatform, UploadStatus } from '../types/upload.js';
import type { VideoDto } from './video.dto.js';

/** Input for the Upload Agent. */
export interface UploadRequestDto {
  readonly contentId: string;
  readonly platform: UploadPlatform;
  readonly video: VideoDto;
  readonly caption: string;
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
