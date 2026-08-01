/** Metadata of a file inside the scratch directory. */
export interface FileDescriptor {
  readonly path: string;
  readonly byteSize: number;
}

/**
 * Contract for scratch-directory management.
 *
 * External system: the filesystem.
 *
 * Every generated artefact lives under `OUTPUT_DIR` and is deleted after a
 * verified upload. Deciding *when* to delete is the Cleanup Agent's rule; this
 * service only performs the operation.
 */
export interface FileSystemService {
  /** Creates the run's scratch directory if it does not exist. */
  ensureDirectory(path: string): Promise<void>;

  /** Lists every file below `path`, recursively. */
  list(path: string): Promise<readonly FileDescriptor[]>;

  /** Deletes a directory and everything inside it. Missing paths are ignored. */
  removeDirectory(path: string): Promise<void>;

  /** Deletes a single file. A missing file is ignored. */
  removeFile(path: string): Promise<void>;
}
