import { z } from 'zod';

import {
  SceneCamera,
  SceneTransition,
  type SceneDto,
  type ScenePlanDto,
  type ScenePlanRequestDto,
} from '../dto/scene.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import { AiMessageRole, type NineRouterService } from '../services/nine-router.service.js';
import { PromptName, type PromptLoader } from '../services/prompt-loader.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';

/**
 * How far the summed scene durations may drift from the requested length.
 *
 * Models are poor at arithmetic across many items, and a couple of seconds of
 * drift is corrected during rendering. A larger gap means the plan does not
 * describe the requested video, and is worth another attempt.
 */
const DURATION_TOLERANCE = 0.2;

/** Accepts `Zoom In` as readily as `zoom in`. */
const lowercased = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.preprocess((value) => (typeof value === 'string' ? value.toLowerCase().trim() : value), schema);

/** Shape the model is asked to answer with. */
const planSchema = z.object({
  scenes: z
    .array(
      z.object({
        scene: z.coerce.number().int().positive(),
        duration: z.coerce.number().int().positive().max(60),
        narration: z.string().trim().min(1),
        imagePrompt: z.string().trim().min(3),
        camera: lowercased(z.enum(SceneCamera)),
        transition: lowercased(z.enum(SceneTransition)),
        style: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * Splits a script into the visual beats of the video.
 *
 * Purpose
 * - Divide the narration into scenes, assign each one a duration, an image
 *   prompt, a camera move, a transition and a visual style, and persist the
 *   plan.
 *
 * Input
 * - {@link ScenePlanRequestDto}
 *
 * Output
 * - {@link ScenePlanDto} — stored in `contents.scene_plan`.
 *
 * Dependencies
 * - `NineRouterService` — proposes the split.
 * - `PromptLoader` — loads `scene.md`.
 * - `ContentRepository` — persists the plan.
 *
 * The plan is the contract the Image, Composer and QA agents will all read
 * from, so it is validated here rather than trusted: contiguous numbering from
 * 1, and a total duration close to the requested length.
 *
 * Must not generate images.
 */
export class SceneAgent implements Agent<ScenePlanRequestDto, ScenePlanDto> {
  public readonly name = 'SceneAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    private readonly promptLoader: PromptLoader,
    private readonly contentRepository: ContentRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(input: ScenePlanRequestDto): Promise<Result<ScenePlanDto>> {
    const logger = this.logger.child({ source: this.name, correlationId: input.correlationId });
    const startedAt = Date.now();
    logger.info('START');

    try {
      const scenes = await this.planScenes(input);
      await this.contentRepository.update(input.script.contentId, { scenes });

      const plan: ScenePlanDto = {
        contentId: input.script.contentId,
        scenes,
        totalDurationSeconds: scenes.reduce((total, scene) => total + scene.duration, 0),
      };

      logger.info('SUCCESS', {
        durationMs: Date.now() - startedAt,
        sceneCount: scenes.length,
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

  /** Asks the model for the shot list and validates its answer. */
  private async planScenes(input: ScenePlanRequestDto): Promise<readonly SceneDto[]> {
    const prompt = await this.promptLoader.render(
      { name: PromptName.Scene },
      {
        script: input.script.script,
        language: input.script.language,
        durationSeconds: String(input.durationSeconds),
        visualStyle: input.visualStyle,
      },
    );

    const payload = await this.nineRouter.completeJson({
      messages: [{ role: AiMessageRole.User, content: prompt }],
      temperature: 0.6,
    });

    const parsed = planSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AgentOutputInvalidError(this.name, 'scene payload failed validation', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    const scenes = parsed.data.scenes;
    this.assertUsable(scenes, input.durationSeconds);

    return scenes;
  }

  /** Rejects a plan that would not produce the requested video. */
  private assertUsable(scenes: readonly SceneDto[], durationSeconds: number): void {
    const misnumbered = scenes.findIndex((scene, index) => scene.scene !== index + 1);

    if (misnumbered !== -1) {
      throw new AgentOutputInvalidError(this.name, 'scene numbering is not contiguous from 1', {
        position: misnumbered + 1,
      });
    }

    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const drift = Math.abs(total - durationSeconds) / durationSeconds;

    if (drift > DURATION_TOLERANCE) {
      throw new AgentOutputInvalidError(this.name, 'scene durations do not match the target', {
        requestedSeconds: durationSeconds,
        plannedSeconds: total,
      });
    }
  }
}
