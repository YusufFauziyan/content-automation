/** Input for the Cleanup Agent. */
export interface CleanupRequestDto {
  /** Directory holding every disposable artefact of the run. */
  readonly outputDirectory: string;
  /**
   * Cleanup only runs once the upload is verified. Passing `false` is a
   * programming error and the agent rejects it.
   */
  readonly uploadVerified: boolean;
}

/** Output of the Cleanup Agent. */
export interface CleanupReportDto {
  readonly deletedPaths: readonly string[];
  readonly freedBytes: number;
}
