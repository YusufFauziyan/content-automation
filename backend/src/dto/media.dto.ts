/**
 * Reference to a file inside `OUTPUT_DIR`.
 *
 * A media asset only ever exists for the duration of a workflow run. Its path
 * is passed between agents but is never persisted: after a verified upload the
 * Cleanup Agent deletes the file (CLAUDE.md "Media Lifecycle").
 */
export interface MediaAssetDto {
  /** Absolute path inside the scratch directory. */
  readonly path: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

/** A media asset whose playback length matters to the composer. */
export interface TimedMediaAssetDto extends MediaAssetDto {
  readonly durationMs: number;
}
