import { z } from 'zod';

import type { ImageConfig } from '../config/app.config.js';
import type { SceneDto } from '../dto/scene.dto.js';
import type {
  VisualPlanDto,
  VisualPlanRequestDto,
  VisualPromptDto,
} from '../dto/visual-prompt.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import { AiMessageRole, type NineRouterService } from '../services/nine-router.service.js';
import { PromptName, type PromptLoader } from '../services/prompt-loader.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';

/** Every field of a brief, all of them required: a blank axis is a vague image. */
const briefSchema = z.object({
  scene: z.coerce.number().int().positive(),
  subject: z.string().trim().min(3),
  environment: z.string().trim().min(3),
  lighting: z.string().trim().min(3),
  cameraAngle: z.string().trim().min(3),
  lens: z.string().trim().min(2),
  composition: z.string().trim().min(3),
  visualStyle: z.string().trim().min(2),
  colorPalette: z.string().trim().min(3),
  quality: z.string().trim().min(2),
  aspectRatio: z.string().trim().min(3),
  consistency: z.string().trim().min(3),
  negative: z.string().trim().min(3),
});

const planSchema = z.object({
  prompts: z.array(briefSchema).min(1).max(30),
});

/** What the model answered, before the prompt string is assembled. */
type VisualBrief = z.infer<typeof briefSchema>;

/** Renders the shot list as the plain text the planner prompt embeds. */
const describeScenes = (scenes: readonly SceneDto[]): string =>
  scenes
    .map((scene) =>
      [
        `Scene ${String(scene.scene)} (${String(scene.duration)}s)`,
        `  narration: ${scene.narration}`,
        `  draft image idea: ${scene.imagePrompt}`,
        `  camera movement: ${scene.camera}`,
      ].join('\n'),
    )
    .join('\n\n');

/**
 * Turns a shot list into a fully specified image brief per scene.
 *
 * Purpose
 * - Decide *what each frame shows* before anything is generated: subject,
 *   environment, lighting, camera angle, lens, composition, style, palette,
 *   quality, aspect ratio, and what must stay consistent between scenes.
 *
 * Input
 * - {@link VisualPlanRequestDto} — the whole plan, because consistency between
 *   scenes cannot be decided one scene at a time.
 *
 * Output
 * - {@link VisualPlanDto} — stored in `contents.visual_plan`.
 *
 * Dependencies
 * - `NineRouterService` — writes the briefs.
 * - `PromptLoader` — loads `visual-prompt.md` and the `image.md` assembly template.
 * - `ContentRepository` — persists the plan.
 *
 * This agent is where prompt quality is decided, which is why it is separate
 * from the Image Agent: a bad frame is almost always a bad brief, and being
 * able to inspect, correct and re-run the brief without spending an image
 * generation is worth an extra step.
 *
 * Never generates images.
 */
export class VisualPlannerAgent implements Agent<VisualPlanRequestDto, VisualPlanDto> {
  public readonly name = 'VisualPlannerAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    private readonly promptLoader: PromptLoader,
    private readonly contentRepository: ContentRepository,
    private readonly imageConfig: ImageConfig,
    private readonly logger: Logger,
  ) {}

  public async execute(input: VisualPlanRequestDto): Promise<Result<VisualPlanDto>> {
    const logger = this.logger.child({ source: this.name, correlationId: input.correlationId });
    const startedAt = Date.now();
    logger.info('START');

    try {
      const briefs = await this.writeBriefs(input);
      const prompts = await this.assemble(briefs);

      await this.contentRepository.update(input.scenePlan.contentId, {
        visualPrompts: prompts,
      });

      logger.info('SUCCESS', {
        durationMs: Date.now() - startedAt,
        promptCount: prompts.length,
      });

      return ok({ contentId: input.scenePlan.contentId, prompts });
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /** Asks the model for one brief per scene and validates its answer. */
  private async writeBriefs(input: VisualPlanRequestDto): Promise<readonly VisualBrief[]> {
    const prompt = await this.promptLoader.render(
      { name: PromptName.VisualPrompt },
      {
        scenes: describeScenes(input.scenePlan.scenes),
        visualStyle: input.visualStyle,
        aspectRatio: input.aspectRatio,
        quality: this.imageConfig.quality,
      },
    );

    const payload = await this.nineRouter.completeJson({
      messages: [{ role: AiMessageRole.User, content: prompt }],
      temperature: 0.7,
    });

    const parsed = planSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AgentOutputInvalidError(this.name, 'visual plan payload failed validation', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    this.assertCoversEveryScene(parsed.data.prompts, input.scenePlan.scenes);

    return parsed.data.prompts;
  }

  /**
   * Rejects a plan that does not describe exactly the scenes that exist.
   *
   * A missing brief would leave a scene with no image, and a stray one would
   * pay for an image nothing can use.
   */
  private assertCoversEveryScene(
    briefs: readonly VisualBrief[],
    scenes: readonly SceneDto[],
  ): void {
    if (briefs.length !== scenes.length) {
      throw new AgentOutputInvalidError(this.name, 'the plan does not cover every scene', {
        sceneCount: scenes.length,
        briefCount: briefs.length,
      });
    }

    const mismatch = briefs.findIndex((brief, index) => brief.scene !== scenes[index]?.scene);

    if (mismatch !== -1) {
      throw new AgentOutputInvalidError(this.name, 'brief scene numbers do not match the plan', {
        position: mismatch + 1,
      });
    }
  }

  /**
   * Renders each brief into the single string an image model receives.
   *
   * The wording lives in `image.md` rather than in this file, so a change to
   * how prompts read is a prompt review and not a code review.
   */
  private async assemble(briefs: readonly VisualBrief[]): Promise<readonly VisualPromptDto[]> {
    return Promise.all(
      briefs.map(async (brief) => ({
        ...brief,
        prompt: (
          await this.promptLoader.render(
            { name: PromptName.Image },
            { ...brief, scene: String(brief.scene) },
          )
        ).trim(),
      })),
    );
  }
}
