import { z } from 'zod';

import type { TopicIdeaDto, TopicIdeaRequestDto } from '../dto/topic-idea.dto.js';
import { AiMessageRole, type NineRouterService } from '../services/nine-router.service.js';
import { PromptName, type PromptLoader } from '../services/prompt-loader.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';

/** Ideas are short by construction; anything longer is the model rambling. */
const ideasSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(8).max(140),
        hook: z.string().trim().min(4).max(300),
        why: z.string().trim().min(4).max(300),
      }),
    )
    .min(1),
});

/**
 * Proposes subjects for someone to choose between.
 *
 * Purpose
 * - Turn "I don't know what to make" into a short list worth picking from.
 *
 * Input
 * - {@link TopicIdeaRequestDto}
 *
 * Output
 * - {@link TopicIdeaDto}[]
 *
 * Dependencies
 * - `NineRouterService` — asks the model.
 * - `PromptLoader` — reads the versioned instruction from `/prompts`.
 *
 * Deliberately writes nothing. The Topic Agent owns the library and its
 * duplicate rule; this one only suggests, so a person can reject four ideas
 * without leaving four rows behind. Whichever idea is picked goes through the
 * ordinary topic path, duplicate check included.
 */
export class TopicIdeasAgent implements Agent<TopicIdeaRequestDto, readonly TopicIdeaDto[]> {
  public readonly name = 'TopicIdeasAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    private readonly promptLoader: PromptLoader,
    private readonly logger: Logger,
  ) {}

  public async execute(input: TopicIdeaRequestDto): Promise<Result<readonly TopicIdeaDto[]>> {
    const logger = this.logger.child({ source: this.name, correlationId: input.correlationId });
    const startedAt = Date.now();
    logger.info('START', { count: input.count, language: input.language, angle: input.angle });

    try {
      const prompt = await this.promptLoader.render(
        { name: PromptName.TopicIdeas },
        {
          count: String(input.count),
          language: input.language,
          angle: input.angle,
          durationSeconds: String(input.durationSeconds),
          excludedTitles:
            input.excludedTitles.length === 0
              ? '(nothing yet)'
              : input.excludedTitles.map((title) => `- ${title}`).join('\n'),
        },
      );

      const payload = await this.nineRouter.completeJson({
        messages: [{ role: AiMessageRole.User, content: prompt }],
        // High, because the point is variety: five near-identical suggestions
        // are the same as one.
        temperature: 1,
      });

      const parsed = ideasSchema.safeParse(payload);

      if (!parsed.success) {
        throw new AgentOutputInvalidError(this.name, 'topic ideas failed validation', {
          issues: parsed.error.issues.map((issue) => issue.message),
        });
      }

      const ideas = parsed.data.ideas.slice(0, input.count);
      logger.info('SUCCESS', { durationMs: Date.now() - startedAt, ideas: ideas.length });

      return ok(ideas);
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }
}
