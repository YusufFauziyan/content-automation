import type { ImageConfig } from '../config/app.config.js';
import type {
  ImageDto,
  ImageGenerationRequestDto,
  ImageGenerationResponseDto,
} from '../dto/image.dto.js';
import type { VisualPromptDto } from '../dto/visual-prompt.dto.js';
import { toNewSceneImage, type ImageRepository } from '../repositories/image.repository.js';
import type { HuggingFaceImageService } from '../services/huggingface-image.service.js';
import type { AiImageResponse, NineRouterService } from '../services/nine-router.service.js';
import {
  WorkspaceFolder,
  type WorkingDirectoryService,
  type WorkspaceDto,
} from '../services/working-directory.service.js';
import type { Agent } from '../types/agent.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';
import { WorkflowStepName } from '../types/workflow.js';
import { describeImage } from '../utils/image/image-metadata.js';

/** Width of the zero-padded scene number in a file name. */
const SCENE_NUMBER_DIGITS = 3;

/**
 * File name for a scene's image, e.g. `scene-001.png`.
 *
 * Fixed-width numbering keeps the files in scene order in every directory
 * listing and in the argument list FFmpeg will later be handed — `scene-10`
 * sorting before `scene-2` is a rendering bug waiting to happen.
 *
 * The extension comes from the bytes rather than from an assumption: the router
 * may answer a request with JPEG whatever was asked for, and a `.png` holding
 * JPEG data misleads every tool that trusts the name.
 */
export const toImageFileName = (sceneNumber: number, extension: string): string =>
  `scene-${String(sceneNumber).padStart(SCENE_NUMBER_DIGITS, '0')}.${extension}`;

/**
 * Generates one image per planned scene.
 *
 * Purpose
 * - Turn each image brief into a PNG on disk, and record what it cost.
 *
 * Input
 * - {@link ImageGenerationRequestDto}
 *
 * Output
 * - {@link ImageGenerationResponseDto}
 *
 * Dependencies
 * - `NineRouterService` — generates the bytes.
 * - `HuggingFaceImageService` — generates them when the router cannot. Optional.
 * - `WorkingDirectoryService` — owns the run's directory and writes the files.
 * - `ImageRepository` — records the metadata.
 *
 * Choosing between the two providers is a decision, not transport, which is why
 * it lives here and not inside either service. Each service knows one external
 * system and nothing about the other.
 *
 * This agent never writes a prompt and never edits one: it sends
 * `VisualPromptDto.prompt` verbatim. If an image is wrong, the brief is wrong,
 * and the Visual Planner Agent is where that gets fixed.
 *
 * Scenes are generated sequentially rather than in parallel. They share one
 * router quota, and a burst of concurrent requests turns a retryable rate limit
 * into a failed step for every scene at once.
 */
export class ImageAgent implements Agent<ImageGenerationRequestDto, ImageGenerationResponseDto> {
  public readonly name = 'ImageAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
    /** Absent when no fallback is configured; then the router is the only source. */
    private readonly huggingFace: HuggingFaceImageService | null,
    private readonly workingDirectory: WorkingDirectoryService,
    private readonly imageRepository: ImageRepository,
    private readonly imageConfig: ImageConfig,
    private readonly logger: Logger,
  ) {}

  public async execute(
    input: ImageGenerationRequestDto,
  ): Promise<Result<ImageGenerationResponseDto>> {
    const logger = this.logger.child({
      source: this.name,
      correlationId: input.correlationId,
      workflowRunId: input.workflowId,
      step: WorkflowStepName.Image,
    });
    const startedAt = Date.now();
    logger.info('START', { sceneCount: input.prompts.length });

    try {
      const workspace = await this.workingDirectory.prepare(input.workflowId);
      const images: ImageDto[] = [];

      for (const prompt of input.prompts) {
        images.push(await this.generateOne(prompt, workspace, input, logger));
      }

      const totalDurationMs = Date.now() - startedAt;
      logger.info('SUCCESS', { durationMs: totalDurationMs, imageCount: images.length });

      return ok({
        contentId: input.contentId,
        workflowId: input.workflowId,
        imagesDirectory: workspace.folders[WorkspaceFolder.Images],
        images,
        totalDurationMs,
      });
    } catch (error) {
      logger.error('FAILED', error, { durationMs: Date.now() - startedAt });

      if (isApplicationError(error)) {
        return fail(error);
      }
      throw error;
    }
  }

  /** Generates, stores and records one scene's image. */
  private async generateOne(
    prompt: VisualPromptDto,
    workspace: WorkspaceDto,
    input: ImageGenerationRequestDto,
    logger: Logger,
  ): Promise<ImageDto> {
    const sceneLogger = logger.child({ scene: prompt.scene });
    const startedAt = Date.now();
    sceneLogger.info('START');

    try {
      const generated = await this.requestImage(prompt, sceneLogger);
      const generationDurationMs = Date.now() - startedAt;

      // What the bytes are, not what was asked for. A router that silently
      // ignores the requested size would otherwise put dimensions in the
      // database that the composer and the quality check go on to trust.
      const metadata = describeImage(generated.data);

      if (metadata === null) {
        throw new AgentOutputInvalidError(
          this.name,
          'the router returned unrecognisable image data',
          {
            scene: prompt.scene,
            byteSize: generated.data.byteLength,
            reportedMimeType: generated.mimeType,
          },
        );
      }

      if (
        metadata.width !== this.imageConfig.width ||
        metadata.height !== this.imageConfig.height
      ) {
        sceneLogger.warn('Generated image does not match the requested size', {
          requested: `${String(this.imageConfig.width)}x${String(this.imageConfig.height)}`,
          received: `${String(metadata.width)}x${String(metadata.height)}`,
        });
      }

      const stored = await this.workingDirectory.write(
        workspace,
        WorkspaceFolder.Images,
        toImageFileName(prompt.scene, metadata.extension),
        generated.data,
      );

      const image: ImageDto = {
        scene: prompt.scene,
        fileName: stored.fileName,
        relativePath: stored.relativePath,
        absolutePath: stored.absolutePath,
        byteSize: stored.byteSize,
        mimeType: metadata.mimeType,
        width: metadata.width,
        height: metadata.height,
        generationDurationMs,
        combo: generated.combo,
      };

      await this.imageRepository.save(
        toNewSceneImage(image, input.contentId, input.workflowId, prompt.prompt),
      );

      sceneLogger.info('SUCCESS', {
        durationMs: generationDurationMs,
        fileName: image.fileName,
        byteSize: image.byteSize,
        combo: image.combo,
      });

      return image;
    } catch (error) {
      sceneLogger.error('FAILED', error, { durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  /**
   * Asks the router for the bytes, and the fallback provider if it will not.
   *
   * The router stays the primary source: it is the project's one configured way
   * to reach a model, and the fallback exists only so an outage there does not
   * end a run that has already paid for a topic, a script and a scene plan.
   *
   * Any failure the router reports is grounds to try the other provider — by
   * the time it has answered, its own retry budget is already spent, so a
   * second opinion costs one more call and nothing else. Errors that are not
   * ours are rethrown untouched: masking a programming mistake behind a
   * provider switch would hide it for as long as the fallback keeps working.
   */
  private async requestImage(prompt: VisualPromptDto, logger: Logger): Promise<AiImageResponse> {
    const request = {
      prompt: prompt.prompt,
      width: this.imageConfig.width,
      height: this.imageConfig.height,
    };

    try {
      return await this.nineRouter.generateImage(request);
    } catch (error) {
      if (this.huggingFace === null || !isApplicationError(error)) {
        throw error;
      }

      logger.warn('Router image generation failed, trying the fallback provider', {
        errorCode: error.code,
        reason: error.message,
      });

      return await this.huggingFace.generateImage(request);
    }
  }
}
