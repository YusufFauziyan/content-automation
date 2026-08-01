import { z } from 'zod';

import type { NewContentDto } from '../dto/content.dto.js';
import type { ScriptDraftDto, ScriptDto, ScriptRequestDto } from '../dto/script.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import { AiMessageRole, type NineRouterService } from '../services/nine-router.service.js';
import { PromptName, type PromptLoader } from '../services/prompt-loader.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';

/** Bounds that keep a short-form script short-form. */
const MIN_HASHTAGS = 3;
const MAX_HASHTAGS = 8;

/** Shape the model is asked to answer with. */
const draftSchema = z.object({
  title: z.string().trim().min(3).max(300),
  hook: z.string().trim().min(3).max(300),
  script: z.string().trim().min(20),
  caption: z.string().trim().max(2200),
  hashtags: z.array(z.string().trim().min(1)).min(MIN_HASHTAGS).max(MAX_HASHTAGS),
  thumbnailPrompt: z.string().trim().min(3),
});

/** Removes a leading `#` so hashtags are stored uniformly. */
const normalizeHashtag = (hashtag: string): string => hashtag.replace(/^#+/u, '').trim();

/**
 * Writes everything the video says and everything that is posted with it.
 *
 * Purpose
 * - Turn an accepted topic into a hook, a narration script, a caption,
 *   hashtags and a thumbnail prompt, in one coherent pass, and persist them.
 *
 * Input
 * - {@link ScriptRequestDto}
 *
 * Output
 * - {@link ScriptDto} — including the id of the `contents` row it created.
 *
 * Dependencies
 * - `NineRouterService` — generates the text.
 * - `PromptLoader` — loads `script.md`.
 * - `ContentRepository` — persists the result.
 *
 * One model call produces all six fields together, because a caption written
 * without sight of the script is a caption for a different video.
 *
 * Must not generate scenes, images or audio.
 */
export class ScriptAgent implements Agent<ScriptRequestDto, ScriptDto> {
  public readonly name = 'ScriptAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    private readonly promptLoader: PromptLoader,
    private readonly contentRepository: ContentRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(input: ScriptRequestDto): Promise<Result<ScriptDto>> {
    const logger = this.logger.child({ source: this.name, correlationId: input.correlationId });
    const startedAt = Date.now();
    logger.info('START');

    try {
      const draft = await this.writeDraft(input);
      const content = await this.persist(input, draft);

      logger.info('SUCCESS', {
        durationMs: Date.now() - startedAt,
        contentId: content.contentId,
      });

      return ok(content);
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /** Asks the model for the script and validates its answer. */
  private async writeDraft(input: ScriptRequestDto): Promise<ScriptDraftDto> {
    const prompt = await this.promptLoader.render(
      { name: PromptName.Script },
      {
        title: input.topic.title,
        description: input.topic.description ?? input.topic.title,
        language: input.topic.language,
        audience: input.audience,
        durationSeconds: String(input.durationSeconds),
      },
    );

    const payload = await this.nineRouter.completeJson({
      messages: [{ role: AiMessageRole.User, content: prompt }],
      temperature: 0.8,
    });

    const parsed = draftSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AgentOutputInvalidError(this.name, 'script payload failed validation', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    return {
      ...parsed.data,
      hashtags: parsed.data.hashtags.map(normalizeHashtag).filter((tag) => tag.length > 0),
    };
  }

  /** Stores the script and returns it with its persistent identity. */
  private async persist(input: ScriptRequestDto, draft: ScriptDraftDto): Promise<ScriptDto> {
    const newContent: NewContentDto = {
      topicId: input.topic.id,
      title: draft.title,
      hook: draft.hook,
      script: draft.script,
      caption: draft.caption,
      hashtags: draft.hashtags,
      thumbnailPrompt: draft.thumbnailPrompt,
      language: input.topic.language,
      targetDurationSeconds: input.durationSeconds,
    };

    const content = await this.contentRepository.create(newContent);

    return {
      ...draft,
      contentId: content.id,
      topicId: content.topicId,
      language: content.language,
      durationSeconds: input.durationSeconds,
    };
  }
}
