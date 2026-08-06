/** Distribution target. The enum is the extension point for new platforms. */
export enum UploadPlatform {
  TikTok = 'TIKTOK',
  YouTube = 'YOUTUBE',
}

/**
 * Lifecycle of a publish attempt.
 *
 * Generated media may only be deleted once the upload reaches
 * {@link UploadStatus.Verified} (ARCHITECTURE.md "Temporary Media Lifecycle").
 */
export enum UploadStatus {
  Pending = 'PENDING',
  Uploading = 'UPLOADING',
  Uploaded = 'UPLOADED',
  Verified = 'VERIFIED',
  Failed = 'FAILED',
}
