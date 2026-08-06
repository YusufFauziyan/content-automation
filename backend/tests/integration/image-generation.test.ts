import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ImageAgent } from '../../src/agents/image.agent.js';
import type { ImageConfig, MediaConfig } from '../../src/config/app.config.js';
import { loadConfig } from '../../src/config/config.loader.js';
import { createDatabase, type Database } from '../../src/database/prisma.client.js';
import type { VisualPromptDto } from '../../src/dto/visual-prompt.dto.js';
import { ContentRepository } from '../../src/repositories/content.repository.js';
import { ImageRepository } from '../../src/repositories/image.repository.js';
import { TopicRepository } from '../../src/repositories/topic.repository.js';
import type { NineRouterService } from '../../src/services/nine-router.service.js';
import { LocalWorkingDirectoryService } from '../../src/services/working-directory.service.js';
import { TopicStatus } from '../../src/types/topic.js';
import { NoopLogger } from '../../src/utils/logger/noop.logger.js';
import { asFake } from '../support/fakes.js';

/**
 * Exercises the image step against the real filesystem and the real database.
 *
 * Everything is real except the router: a stub stands in for it so the suite
 * spends no money and needs no network, which is the one rule integration tests
 * here must never break (PROJECT_RULES.md "Testing").
 *
 * Requires the Docker PostgreSQL instance (`pnpm db:up && pnpm db:migrate`).
 */
const databaseAvailable = process.env['DATABASE_URL'] !== undefined;

/** A one-pixel PNG — real bytes, so the file written is a real file. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const imageConfig: ImageConfig = {
  width: 1024,
  height: 1792,
  aspectRatio: '4:7',
  quality: 'high detail',
};

const stubRouter: NineRouterService = {
  complete: () => Promise.reject(new Error('not used')),
  completeJson: () => Promise.reject(new Error('not used')),
  generateImage: () =>
    Promise.resolve({
      data: new Uint8Array(PNG_BYTES),
      mimeType: 'image/png',
      combo: 'test-image-combo',
    }),
};

const prompt = (scene: number): VisualPromptDto =>
  asFake<VisualPromptDto>({ scene, prompt: `assembled prompt for scene ${String(scene)}` });

describe.skipIf(!databaseAvailable)('Image generation', () => {
  const createdTopicIds: string[] = [];
  let database: Database;
  let agent: ImageAgent;
  let imageRepository: ImageRepository;
  let outputDirectory: string;
  let contentId: string;
  // A real run id: `scene_images.workflow_run_id` is a uuid column, and the
  // workspace is named after the same value.
  const workflowId = randomUUID();

  beforeAll(async () => {
    if (!databaseAvailable) {
      return;
    }

    outputDirectory = await mkdtemp(join(tmpdir(), 'yu-tomation-images-'));
    const mediaConfig: MediaConfig = { outputDirectory, promptsDirectory: outputDirectory };

    database = createDatabase(loadConfig().database);
    imageRepository = new ImageRepository(database);
    agent = new ImageAgent(
      stubRouter,
      new LocalWorkingDirectoryService(mediaConfig),
      imageRepository,
      imageConfig,
      new NoopLogger(),
    );

    const title = `Image integration ${String(process.hrtime.bigint())}`;
    const topic = await new TopicRepository(database).create({
      title,
      normalizedTitle: title.toLowerCase(),
      description: null,
      language: 'en',
      category: 'testing',
      audience: 'engineers',
      status: TopicStatus.Accepted,
    });
    createdTopicIds.push(topic.id);

    const content = await new ContentRepository(database).create({
      topicId: topic.id,
      title: 'A stored title',
      hook: 'A hook.',
      script: 'A hook. And the body.',
      caption: null,
      hashtags: [],
      thumbnailPrompt: null,
      language: 'en',
      targetDurationSeconds: 10,
    });
    contentId = content.id;
  });

  afterAll(async () => {
    if (!databaseAvailable) {
      return;
    }
    await database.topic.deleteMany({ where: { id: { in: createdTopicIds } } });
    await database.$disconnect();
    await rm(outputDirectory, { recursive: true, force: true });
  });

  it('writes one PNG per scene into output/workflows/{workflowId}/images', async () => {
    const result = await agent.execute({
      correlationId: 'integration-run',
      workflowId,
      contentId,
      prompts: [prompt(1), prompt(2), prompt(3)],
    });

    expect(result.success).toBe(true);

    const images = result.success ? result.data.images : [];
    expect(images.map((image) => image.fileName)).toEqual([
      'scene-001.png',
      'scene-002.png',
      'scene-003.png',
    ]);

    for (const image of images) {
      expect(image.absolutePath).toBe(
        join(outputDirectory, 'workflows', workflowId, 'images', image.fileName),
      );
      await expect(readFile(image.absolutePath)).resolves.toEqual(PNG_BYTES);
    }
  });

  it('records metadata for every image, and no bytes', async () => {
    const stored = await imageRepository.findByContentId(contentId);

    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({
      sceneNumber: 1,
      fileName: 'scene-001.png',
      relativePath: join('images', 'scene-001.png'),
      byteSize: PNG_BYTES.byteLength,
      combo: 'test-image-combo',
    });
    expect(stored[0]?.prompt).toBe('assembled prompt for scene 1');
  });

  it('records the dimensions the bytes actually have, not the ones requested', async () => {
    const stored = await imageRepository.findByContentId(contentId);

    // The stub returns a 1x1 PNG while the config asks for 1024x1792. Storing
    // the request would put numbers in the database that the composer and the
    // quality check would later trust and act on.
    expect(stored[0]).toMatchObject({ width: 1, height: 1 });
  });

  it('replaces a scene rather than accumulating takes when it is generated again', async () => {
    await agent.execute({
      correlationId: 'integration-run',
      workflowId,
      contentId,
      prompts: [prompt(1)],
    });

    const stored = await imageRepository.findByContentId(contentId);

    expect(stored).toHaveLength(3);
  });
});
