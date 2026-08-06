import type { Content as ContentRecord, Prisma } from '../database/generated/client.js';
import type { Database } from '../database/prisma.client.js';
import { fromJsonColumn, runQuery, toJsonColumn } from '../database/query.js';
import type { ContentDto, ContentUpdateDto, NewContentDto } from '../dto/content.dto.js';
import type { NarrationBlockDto } from '../dto/narration.dto.js';
import type { SceneDto } from '../dto/scene.dto.js';
import type { VisualPromptDto } from '../dto/visual-prompt.dto.js';

/** Maps a database row onto the domain DTO. */
const toDto = (record: ContentRecord): ContentDto => ({
  id: record.id,
  topicId: record.topicId,
  title: record.title,
  hook: record.hook,
  script: record.script,
  caption: record.caption,
  hashtags: record.hashtags,
  thumbnailPrompt: record.thumbnailPrompt,
  scenes: fromJsonColumn<readonly SceneDto[]>(record.scenePlan),
  visualPrompts: fromJsonColumn<readonly VisualPromptDto[]>(record.visualPlan),
  narrationBlocks: fromJsonColumn<readonly NarrationBlockDto[]>(record.narrationPlan),
  language: record.language,
  targetDurationSeconds: record.targetDurationSeconds,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/**
 * Persistence for authored content: script, caption, hashtags, thumbnail
 * prompt and scene plan.
 *
 * Tables
 * - `contents`
 *
 * Methods
 * - {@link create}
 * - {@link findById}
 * - {@link findByTopicId}
 * - {@link update}
 * - {@link delete}
 *
 * The scene plan is stored as JSON because it is written once by the Scene
 * Agent and always read as a whole; no query ever filters on an individual
 * scene.
 */
export class ContentRepository {
  constructor(private readonly database: Database) {}

  /** Inserts the content authored for a topic. */
  public async create(input: NewContentDto): Promise<ContentDto> {
    const record = await runQuery('ContentRepository.create', () =>
      this.database.content.create({
        data: {
          topicId: input.topicId,
          title: input.title,
          hook: input.hook,
          script: input.script,
          caption: input.caption,
          hashtags: [...input.hashtags],
          thumbnailPrompt: input.thumbnailPrompt,
          language: input.language,
          targetDurationSeconds: input.targetDurationSeconds,
        },
      }),
    );

    return toDto(record);
  }

  /** Returns the content, or `null` when the id is unknown. */
  public async findById(id: string): Promise<ContentDto | null> {
    const record = await runQuery('ContentRepository.findById', () =>
      this.database.content.findUnique({ where: { id } }),
    );

    return record === null ? null : toDto(record);
  }

  /** Returns every content row authored for a topic, newest first. */
  public async findByTopicId(topicId: string): Promise<readonly ContentDto[]> {
    const records = await runQuery('ContentRepository.findByTopicId', () =>
      this.database.content.findMany({
        where: { topicId },
        orderBy: { createdAt: 'desc' },
      }),
    );

    return records.map(toDto);
  }

  /** Applies a partial revision. Fields left out are untouched. */
  public async update(id: string, input: ContentUpdateDto): Promise<ContentDto> {
    const data: Prisma.ContentUpdateInput = {};

    if (input.caption !== undefined) {
      data.caption = input.caption;
    }
    if (input.hashtags !== undefined) {
      data.hashtags = [...input.hashtags];
    }
    if (input.thumbnailPrompt !== undefined) {
      data.thumbnailPrompt = input.thumbnailPrompt;
    }
    if (input.scenes !== undefined) {
      data.scenePlan = toJsonColumn(input.scenes);
    }
    if (input.visualPrompts !== undefined) {
      data.visualPlan = toJsonColumn(input.visualPrompts);
    }
    if (input.narrationBlocks !== undefined) {
      data.narrationPlan = toJsonColumn(input.narrationBlocks);
    }

    const record = await runQuery('ContentRepository.update', () =>
      this.database.content.update({ where: { id }, data }),
    );

    return toDto(record);
  }

  /** Removes the content together with its upload records (cascade). */
  public async delete(id: string): Promise<void> {
    await runQuery('ContentRepository.delete', () =>
      this.database.content.delete({ where: { id } }),
    );
  }
}
