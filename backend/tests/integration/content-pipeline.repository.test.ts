import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.loader.js';
import { createDatabase, type Database } from '../../src/database/prisma.client.js';
import { ContentRepository } from '../../src/repositories/content.repository.js';
import { TopicRepository } from '../../src/repositories/topic.repository.js';
import { SceneCamera, SceneTransition, type SceneDto } from '../../src/dto/scene.dto.js';
import type { TopicDto } from '../../src/dto/topic.dto.js';
import { TopicStatus } from '../../src/types/topic.js';

/**
 * Integration coverage for the two repositories the text pipeline writes to.
 *
 * Requires the Docker PostgreSQL instance (`pnpm db:up && pnpm db:migrate`).
 * The suite skips itself when `DATABASE_URL` is absent. No external API is
 * involved: nothing here calls the AI router.
 */
const databaseAvailable = process.env['DATABASE_URL'] !== undefined;

/** Keeps titles unique across repeated local runs. */
const uniqueTitle = (label: string): string => `${label} ${String(process.hrtime.bigint())}`;

const SCENES: readonly SceneDto[] = [
  {
    scene: 1,
    duration: 5,
    narration: 'First beat.',
    imagePrompt: 'A quiet room',
    camera: SceneCamera.ZoomIn,
    transition: SceneTransition.Fade,
    style: 'cinematic',
  },
];

describe.skipIf(!databaseAvailable)('Text pipeline repositories', () => {
  const createdTopicIds: string[] = [];
  let database: Database;
  let topicRepository: TopicRepository;
  let contentRepository: ContentRepository;

  beforeAll(() => {
    if (!databaseAvailable) {
      return;
    }
    database = createDatabase(loadConfig().database);
    topicRepository = new TopicRepository(database);
    contentRepository = new ContentRepository(database);
  });

  afterAll(async () => {
    if (!databaseAvailable) {
      return;
    }
    // Content and embeddings cascade from the topic.
    await database.topic.deleteMany({ where: { id: { in: createdTopicIds } } });
    await database.$disconnect();
  });

  /** Creates a topic and remembers it for cleanup. */
  const createTopic = async (title: string): Promise<TopicDto> => {
    const topic = await topicRepository.create({
      title,
      normalizedTitle: title.toLowerCase(),
      description: 'Created by an integration test.',
      language: 'en',
      category: 'testing',
      audience: 'engineers',
      status: TopicStatus.Accepted,
    });
    createdTopicIds.push(topic.id);

    return topic;
  };

  it('stores and reads back a topic', async () => {
    const title = uniqueTitle('Integration topic');
    const created = await createTopic(title);

    const found = await topicRepository.findById(created.id);

    expect(found?.title).toBe(title);
    expect(found?.category).toBe('testing');
    expect(found?.status).toBe(TopicStatus.Accepted);
  });

  it('finds a topic by its normalised title', async () => {
    const title = uniqueTitle('Normalised lookup');
    await createTopic(title);

    const found = await topicRepository.findByNormalizedTitle(title.toLowerCase());

    expect(found?.title).toBe(title);
  });

  it('refuses a second topic with the same normalised title', async () => {
    const title = uniqueTitle('Duplicate guard');
    await createTopic(title);

    await expect(createTopic(title)).rejects.toThrow();
  });

  it('lists recent titles for a category', async () => {
    const title = uniqueTitle('Recent title');
    await createTopic(title);

    const titles = await topicRepository.findRecentTitles('testing', 50);

    expect(titles).toContain(title);
  });

  it('stores a script and its scene plan against the topic', async () => {
    const topic = await createTopic(uniqueTitle('Script owner'));

    const content = await contentRepository.create({
      topicId: topic.id,
      title: 'A stored title',
      hook: 'A stored hook.',
      script: 'A stored hook. And the body.',
      caption: 'A caption',
      hashtags: ['investing', 'finance'],
      thumbnailPrompt: 'A rising chart',
      language: 'en',
      targetDurationSeconds: 45,
    });

    const updated = await contentRepository.update(content.id, { scenes: SCENES });

    expect(updated.hook).toBe('A stored hook.');
    expect(updated.hashtags).toEqual(['investing', 'finance']);
    expect(updated.scenes).toHaveLength(1);
    expect(updated.scenes?.[0]?.camera).toBe(SceneCamera.ZoomIn);
  });

  it('reads content back by topic', async () => {
    const topic = await createTopic(uniqueTitle('Content owner'));
    await contentRepository.create({
      topicId: topic.id,
      title: 'Another title',
      hook: null,
      script: 'Body only.',
      caption: null,
      hashtags: [],
      thumbnailPrompt: null,
      language: 'en',
      targetDurationSeconds: null,
    });

    const found = await contentRepository.findByTopicId(topic.id);

    expect(found).toHaveLength(1);
    expect(found[0]?.scenes).toBeNull();
  });
});
