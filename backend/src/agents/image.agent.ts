import type { ImageConfig } from '../config/app.config.js';
import type {
  ImageDto,
  ImageGenerationRequestDto,
  ImageGenerationResponseDto,
} from '../dto/image.dto.js';
import type { VisualPromptDto } from '../dto/visual-prompt.dto.js';
import { toNewSceneImage, type ImageRepository } from '../repositories/image.repository.js';
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
 * Recorded as the producer of a still that was already in the workspace.
 *
 * Provenance has to survive: a run served partly by a person and partly by a
 * provider should be readable from `scene_images.combo` alone, months later.
 */
const MANUAL_COMBO = 'manual';

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
 * - `WorkingDirectoryService` — owns the run's directory and writes the files.
 * - `ImageRepository` — records the metadata.
 *
 * This agent never writes a prompt and never edits one: it sends
 * `VisualPromptDto.prompt` verbatim. If an image is wrong, the brief is wrong,
 * and the Visual Planner Agent is where that gets fixed.
 *
 * Scenes are generated sequentially rather than in parallel. They share one
 * router quota, and a burst of concurrent requests turns a retryable rate limit
 * into a failed step for every scene at once.
 *
 * A scene that already has a file in the workspace is adopted rather than
 * regenerated. That is what makes a stalled run recoverable by hand: when no
 * provider will produce a still, a person can put one there themselves, and
 * resuming keeps it instead of throwing the work away.
 */
export class ImageAgent implements Agent<ImageGenerationRequestDto, ImageGenerationResponseDto> {
  public readonly name = 'ImageAgent';

  constructor(
    private readonly nineRouter: NineRouterService,
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

      const existing = await this.workingDirectory.list(workspace, WorkspaceFolder.Images);
      let generated = 0;

      for (const prompt of input.prompts) {
        const adopted = await this.adoptExisting(prompt, workspace, input, existing, logger);

        if (adopted !== null) {
          images.push(adopted);
          continue;
        }

        images.push(await this.generateOne(prompt, workspace, input, logger));
        generated += 1;
      }

      // Worth saying out loud: a step that cost nothing looks identical to one
      // that quietly spent a minute of model time unless it says which it was.
      if (generated === 0) {
        logger.info('Every scene was already supplied — nothing was generated', {
          adopted: images.length,
        });
      }

      const totalDurationMs = Date.now() - startedAt;
      logger.info('SUCCESS', {
        durationMs: totalDurationMs,
        imageCount: images.length,
        generated,
        adopted: images.length - generated,
      });

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

  /**
   * Takes a still already sitting in the workspace, when there is one.
   *
   * The bytes are validated exactly as a generated image would be, because a
   * file supplied by hand is no more trustworthy than one that arrived over the
   * network — a truncated upload named `scene-006.jpg` must not reach the
   * renderer. An unreadable file is ignored and the scene is generated instead.
   *
   * @returns The adopted image, or null when this scene has no usable file.
   */
  private async adoptExisting(
    prompt: VisualPromptDto,
    workspace: WorkspaceDto,
    input: ImageGenerationRequestDto,
    existing: readonly string[],
    logger: Logger,
  ): Promise<ImageDto | null> {
    const stem = `scene-${String(prompt.scene).padStart(SCENE_NUMBER_DIGITS, '0')}.`;
    const fileName = existing.find((name) => name.startsWith(stem));

    if (fileName === undefined) {
      return null;
    }

    const sceneLogger = logger.child({ scene: prompt.scene });
    const bytes = await this.workingDirectory.read(workspace, WorkspaceFolder.Images, fileName);
    const metadata = describeImage(bytes);

    if (metadata === null) {
      sceneLogger.warn('Ignoring an unreadable file already in the workspace', {
        fileName,
        byteSize: bytes.byteLength,
      });
      return null;
    }

    const stored = await this.workingDirectory.describe(
      workspace,
      WorkspaceFolder.Images,
      fileName,
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
      generationDurationMs: 0,
      combo: MANUAL_COMBO,
    };

    await this.imageRepository.save(
      toNewSceneImage(image, input.contentId, input.workflowId, prompt.prompt),
    );

    sceneLogger.info('ADOPTED', {
      fileName: image.fileName,
      byteSize: image.byteSize,
      size: `${String(metadata.width)}x${String(metadata.height)}`,
    });

    return image;
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
      const generated = await this.requestImage(prompt);
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
   * Asks the router for the bytes.
   *
   * There is no second provider. When the router will not produce a still the
   * step fails and the run stops here, which is the point: a person then
   * supplies the picture and resumes, and that is a better answer than a
   * fallback quietly producing something in a different style.
   */
  private requestImage(prompt: VisualPromptDto): Promise<AiImageResponse> {
    return this.nineRouter.generateImage({
      prompt: prompt.prompt,
      width: this.imageConfig.width,
      height: this.imageConfig.height,
    });
  }
}
