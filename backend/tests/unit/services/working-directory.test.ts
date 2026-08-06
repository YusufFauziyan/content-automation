import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MediaConfig } from '../../../src/config/app.config.js';
import {
  LocalWorkingDirectoryService,
  WorkspaceFolder,
} from '../../../src/services/working-directory.service.js';
import { UnsafeWorkspacePathError } from '../../../src/types/errors/workspace.error.js';

/**
 * Exercises the real filesystem in a throwaway directory.
 *
 * Mocking `node:fs` here would test the mock: the whole responsibility of this
 * service is that the directories and files actually appear.
 */
describe('LocalWorkingDirectoryService', () => {
  let outputDirectory: string;
  let service: LocalWorkingDirectoryService;

  beforeAll(async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), 'yu-tomation-workspace-'));
    const mediaConfig: MediaConfig = { outputDirectory, promptsDirectory: outputDirectory };
    service = new LocalWorkingDirectoryService(mediaConfig);
  });

  afterAll(async () => {
    await rm(outputDirectory, { recursive: true, force: true });
  });

  it('creates output/workflows/{workflowId} with every artefact folder', async () => {
    const workspace = await service.prepare('run-1');

    expect(workspace.root).toBe(join(outputDirectory, 'workflows', 'run-1'));

    for (const folder of Object.values(WorkspaceFolder)) {
      const stats = await stat(workspace.folders[folder]);
      expect(stats.isDirectory()).toBe(true);
    }
  });

  it('can be called again for a run that already has a workspace', async () => {
    await service.prepare('run-2');

    await expect(service.prepare('run-2')).resolves.toMatchObject({ workflowId: 'run-2' });
  });

  it('writes a file into the requested folder and reports its relative path', async () => {
    const workspace = await service.prepare('run-3');
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const stored = await service.write(workspace, WorkspaceFolder.Images, 'scene-001.png', bytes);

    expect(stored.relativePath).toBe(join('images', 'scene-001.png'));
    expect(stored.byteSize).toBe(4);
    await expect(readFile(stored.absolutePath)).resolves.toEqual(Buffer.from(bytes));
  });

  it('overwrites a file when a scene is generated again', async () => {
    const workspace = await service.prepare('run-4');

    await service.write(workspace, WorkspaceFolder.Images, 'scene-001.png', new Uint8Array([1]));
    const second = await service.write(
      workspace,
      WorkspaceFolder.Images,
      'scene-001.png',
      new Uint8Array([1, 2, 3]),
    );

    expect(second.byteSize).toBe(3);
  });

  it('refuses a workflow id that would escape the output directory', async () => {
    await expect(service.prepare('../../etc')).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
  });

  it('refuses a file name that contains a separator', async () => {
    const workspace = await service.prepare('run-5');

    await expect(
      service.write(workspace, WorkspaceFolder.Images, '../escape.png', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(UnsafeWorkspacePathError);
  });

  it('removes the whole workspace', async () => {
    const workspace = await service.prepare('run-6');
    await service.write(workspace, WorkspaceFolder.Images, 'scene-001.png', new Uint8Array([1]));

    await service.remove('run-6');

    await expect(stat(workspace.root)).rejects.toThrow();
  });

  it('treats removing a missing workspace as done', async () => {
    await expect(service.remove('never-existed')).resolves.toBeUndefined();
  });
});
