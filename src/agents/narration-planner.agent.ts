import { z } from 'zod';

import type { NarrationConfig } from '../config/app.config.js';
import {
  NarrationEmphasis,
  type NarrationBlockDto,
  type NarrationPlanDto,
  type NarrationPlanRequestDto,
} from '../dto/narration.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import { AiMessageRole, type NineRouterService } from '../services/nine-router.service.js';
import { PromptName, type PromptLoader } from '../services/prompt-loader.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';

const SECONDS_PER_MINUTE = 60;

/** Longest pause the plan may hold between two blocks, in seconds. */
const MAX_PAUSE_SECONDS = 2;

/**
 * How much of the script the blocks must reproduce before the plan is accepted.
 *
 * The blocks are what gets spoken *and* what gets shown as subtitles, so a
 * model that quietly paraphrases or drops a clause would desynchronise the two
 * artefacts from the script that was approved. Comparing on letters and digits
 * alone tolerates the punctuation and spacing a split legitimately changes.
 */
const MIN_SCRIPT_COVERAGE = 0.95;

/** Shape the model is asked to answer with. */
const planSchema = z.object({
  blocks: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        pauseAfter: z.coerce.number().min(0).max(MAX_PAUSE_SECONDS),
        emphasis: z.preprocess(
          (value) => (typeof value === 'string' ? value.toLowerCase().trim() : value),
          z.enum(NarrationEmphasis),
        ),
      }),
    )
    .min(1)
    .max(60),
});

/** Reduces text to the letters and digits it contains, lower case. */
const toComparable = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Counts words the way a speaking rate does: runs of non-space. */
export const countWords = (text: string): number =>
  text.trim() === '' ? 0 : text.trim().split(/\s+/u).length;

/**
 * Estimates how long a block takes to read, in seconds.
 *
 * Computed rather than asked of the model: subtitle timing is derived from
 * these numbers, so they have to be reproducible and consistent with each
 * other. A language model's arithmetic across twenty blocks is neither, and a
 * drifting estimate shows up directly as subtitles that lag the voice.
 *
 * @param text           The words spoken in the block.
 * @param wordsPerMinute Speaking rate, from configuration.
 * @param speed          Playback multiplier the voice is rendered at.
 */
export const estimateDurationSeconds = (
  text: string,
  wordsPerMinute: number,
  speed: number,
): number => {
  const words = countWords(text);
  const seconds = (words / wordsPerMinute) * SECONDS_PER_MINUTE * (1 / speed);

  return Math.max(0.1, Math.round(seconds * 10) / 10);
};

/**
 * Splits a script into timed narration blocks.
 *
 * Purpose
 * - Decide what is spoken as one breath, how long each breath takes and how
 *   long the silence after it lasts.
 *
 * Input
 * - {@link NarrationPlanRequestDto}
 *
 * Output
 * - {@link NarrationPlanDto} — stored in `contents.narration_plan`.
 *
 * Dependencies
 * - `NineRouterService` — proposes the split.
 * - `PromptLoader` — loads `narration.md`.
 * - `ContentRepository` — persists the plan.
 *
 * The plan is the single source both the audio and the subtitles are rendered
 * from. That is what removes the need for a transcription step: the words and
 * their timings are decided once, here, rather than generated twice and then
 * reconciled.
 *
 * Never synthesises audio and never writes a subtitle file.
 */
export class NarrationPlannerAgent implements Agent<NarrationPlanRequestDto, NarrationPlanDto> {
  public readonly name = 'NarrationPlannerAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    private readonly promptLoader: PromptLoader,
    private readonly contentRepository: ContentRepository,
    private readonly narrationConfig: NarrationConfig,
    private readonly speed: number,
    private readonly logger: Logger,
  ) {}

  public async execute(input: NarrationPlanRequestDto): Promise<Result<NarrationPlanDto>> {
    const logger = this.logger.child({ source: this.name, correlationId: input.correlationId });
    const startedAt = Date.now();
    logger.info('START');

    try {
      const blocks = await this.planBlocks(input);
      await this.contentRepository.update(input.script.contentId, { narrationBlocks: blocks });

      const plan: NarrationPlanDto = {
        contentId: input.script.contentId,
        blocks,
        totalDurationSeconds:
          Math.round(
            blocks.reduce((total, block) => total + block.estimatedDuration + block.pauseAfter, 0) *
              10,
          ) / 10,
      };

      logger.info('SUCCESS', {
        durationMs: Date.now() - startedAt,
        blockCount: blocks.length,
        totalDurationSeconds: plan.totalDurationSeconds,
      });

      return ok(plan);
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /** Asks the model for the split, then times it deterministically. */
  private async planBlocks(input: NarrationPlanRequestDto): Promise<readonly NarrationBlockDto[]> {
    const prompt = await this.promptLoader.render(
      { name: PromptName.Narration },
      {
        script: input.script.script,
        language: input.script.language,
        durationSeconds: String(input.durationSeconds),
      },
    );

    const payload = await this.nineRouter.completeJson({
      messages: [{ role: AiMessageRole.User, content: prompt }],
      temperature: 0.3,
    });

    const parsed = planSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AgentOutputInvalidError(this.name, 'narration payload failed validation', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    this.assertFaithful(parsed.data.blocks, input.script.script);

    const lastIndex = parsed.data.blocks.length - 1;

    return parsed.data.blocks.map((block, index) => ({
      id: index + 1,
      text: block.text,
      estimatedDuration: estimateDurationSeconds(
        block.text,
        this.narrationConfig.wordsPerMinute,
        this.speed,
      ),
      // Silence after the last block would be dead air at the end of the video.
      pauseAfter: index === lastIndex ? 0 : block.pauseAfter,
      emphasis: block.emphasis,
    }));
  }

  /** Rejects a split that does not say what the script says. */
  private assertFaithful(blocks: readonly { text: string }[], script: string): void {
    const spoken = toComparable(blocks.map((block) => block.text).join(''));
    const expected = toComparable(script);

    if (expected === '') {
      return;
    }

    // Longest common subsequence would be exact but quadratic; for text of this
    // size, comparing lengths after normalisation catches paraphrase and
    // omission, which are the failures that matter.
    const coverage = spoken.length / expected.length;

    if (coverage < MIN_SCRIPT_COVERAGE || coverage > 1 / MIN_SCRIPT_COVERAGE) {
      throw new AgentOutputInvalidError(this.name, 'the blocks do not reproduce the script', {
        scriptCharacters: expected.length,
        spokenCharacters: spoken.length,
      });
    }
  }
}
