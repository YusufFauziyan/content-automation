import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { MediaConfig } from '../config/app.config.js';
import { UnsafeWorkspacePathError, WorkspaceError } from '../types/errors/workspace.error.js';

/** Sub-directories every run gets, one per kind of artefact. */
export enum WorkspaceFolder {
  Images = 'images',
  Audio = 'audio',
  Subtitle = 'subtitle',
  Video = 'video',
  Thumbnail = 'thumbnail',
}

/** Where one run's artefacts live on disk. */
export interface WorkspaceDto {
  readonly workflowId: string;
  /** Absolute path of `output/workflows/{workflowId}`. */
  readonly root: string;
  /** Absolute path of each sub-directory. */
  readonly folders: Readonly<Record<WorkspaceFolder, string>>;
}

/** A file that has been written into the workspace. */
export interface StoredFileDto {
  readonly fileName: string;
  /** Path relative to the workspace root, e.g. `images/scene-001.png`. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly byteSize: number;
}

/**
 * Contract for the run's working directory.
 *
 * External system: the filesystem.
 *
 * Everything written here is disposable. The service owns the layout so that no
 * other class has to know it, and so that cleanup is one recursive delete of a
 * directory whose name is the workflow id.
 */
export interface WorkingDirectoryService {
  /**
   * Creates `output/workflows/{workflowId}` and every sub-directory.
   *
   * Safe to call again for a run that already has one, which is what makes a
   * resumed run able to keep writing into the directory it started.
   */
  prepare(workflowId: string): Promise<WorkspaceDto>;

  /** Writes one file into a sub-directory of the workspace. */
  write(
    workspace: WorkspaceDto,
    folder: WorkspaceFolder,
    fileName: string,
    data: Uint8Array,
  ): Promise<StoredFileDto>;

  /**
   * Absolute path a file would occupy, without creating anything.
   *
   * Needed by anything that hands a destination to an external tool: FFmpeg
   * writes its own output, so the workspace must be able to name a location it
   * does not itself write.
   */
  resolve(workspace: WorkspaceDto, folder: WorkspaceFolder, fileName: string): string;

  /**
   * Measures a file another process wrote into the workspace.
   *
   * The counterpart to {@link resolve}: what came back is described the same
   * way as anything this service wrote itself.
   */
  describe(
    workspace: WorkspaceDto,
    folder: WorkspaceFolder,
    fileName: string,
  ): Promise<StoredFileDto>;

  /** Deletes the whole workspace. A missing directory is not an error. */
  remove(workflowId: string): Promise<void>;
}

/** Directory holding every run's workspace, under the configured output root. */
const WORKFLOWS_DIRECTORY = 'workflows';

/** Identifiers and file names that may safely become a path segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Rejects anything that could escape the workspace.
 *
 * Workflow ids come from the database and file names are derived from scene
 * numbers, so neither should ever contain a separator — which is exactly why a
 * value that does is worth refusing rather than sanitising.
 */
const assertSafeSegment = (segment: string): string => {
  if (!SAFE_SEGMENT.test(segment) || segment.includes('..')) {
    throw new UnsafeWorkspacePathError(segment);
  }

  return segment;
};

/**
 * Filesystem implementation of {@link WorkingDirectoryService}.
 *
 * The output root arrives through {@link MediaConfig}, so a deployment can put
 * scratch space on a different volume without a code change.
 */
export class LocalWorkingDirectoryService implements WorkingDirectoryService {
  constructor(private readonly mediaConfig: MediaConfig) {}

  public async prepare(workflowId: string): Promise<WorkspaceDto> {
    const root = join(
      this.mediaConfig.outputDirectory,
      WORKFLOWS_DIRECTORY,
      assertSafeSegment(workflowId),
    );

    const folders = Object.fromEntries(
      Object.values(WorkspaceFolder).map((folder) => [folder, join(root, folder)]),
    ) as Record<WorkspaceFolder, string>;

    try {
      await Promise.all(Object.values(folders).map((path) => mkdir(path, { recursive: true })));
    } catch (error) {
      throw new WorkspaceError('Could not prepare the working directory.', {
        root,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return { workflowId, root, folders };
  }

  public async write(
    workspace: WorkspaceDto,
    folder: WorkspaceFolder,
    fileName: string,
    data: Uint8Array,
  ): Promise<StoredFileDto> {
    const absolutePath = join(workspace.folders[folder], assertSafeSegment(fileName));

    try {
      await writeFile(absolutePath, data);
    } catch (error) {
      throw new WorkspaceError('Could not write into the working directory.', {
        absolutePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      fileName,
      relativePath: relative(workspace.root, absolutePath),
      absolutePath,
      byteSize: data.byteLength,
    };
  }

  public resolve(workspace: WorkspaceDto, folder: WorkspaceFolder, fileName: string): string {
    return join(workspace.folders[folder], assertSafeSegment(fileName));
  }

  public async describe(
    workspace: WorkspaceDto,
    folder: WorkspaceFolder,
    fileName: string,
  ): Promise<StoredFileDto> {
    const absolutePath = this.resolve(workspace, folder, fileName);

    try {
      const stats = await stat(absolutePath);

      return {
        fileName,
        relativePath: relative(workspace.root, absolutePath),
        absolutePath,
        byteSize: stats.size,
      };
    } catch (error) {
      throw new WorkspaceError('Could not read a file in the working directory.', {
        absolutePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async remove(workflowId: string): Promise<void> {
    const root = join(
      this.mediaConfig.outputDirectory,
      WORKFLOWS_DIRECTORY,
      assertSafeSegment(workflowId),
    );

    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      throw new WorkspaceError('Could not remove the working directory.', {
        root,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
