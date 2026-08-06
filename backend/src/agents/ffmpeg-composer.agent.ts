import type { VideoConfig } from '../config/app.config.js';
import type { RenderPlanDto } from '../dto/render-plan.dto.js';
import type { VideoDto, VideoRenderRequestDto, VideoRenderResponseDto } from '../dto/video.dto.js';
import { toNewRenderedVideo, type VideoRepository } from '../repositories/video.repository.js';
import type { FfmpegService } from '../services/ffmpeg.service.js';
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
import { pickCoverImage } from '../utils/video/cover-frame.js';

/** The finished video is always this file, in the run's `video/` folder. */
export const VIDEO_FILE_NAME = 'final.mp4';

/** The cover sits beside it, under a fixed name so a resume can find it. */
export const COVER_FILE_NAME = 'cover.jpg';

/**
 * Renders a plan into the finished video.
 *
 * Purpose
 * - Execute the timeline, and record what came out.
 *
 * Input
 * - {@link VideoRenderRequestDto}
 *
 * Output
 * - {@link VideoRenderResponseDto}
 *
 * Dependencies
 * - `FfmpegService` — runs the encoder.
 * - `WorkingDirectoryService` — owns the run's directory.
 * - `VideoRepository` — records the metadata.
 *
 * The agent computes no timing, rewrites no subtitle and re-mixes no narration:
 * it hands the plan to the service and measures the result. Every decision was
 * already made by the Timeline Builder Agent, which is what makes a render
 * repeatable and a bad video traceable to the plan that produced it.
 *
 * What it *does* decide is whether the result is acceptable at all — a file the
 * encoder wrote but that contains no video stream is a failure worth catching
 * here rather than at upload.
 */
export class FfmpegComposerAgent implements Agent<VideoRenderRequestDto, VideoRenderResponseDto> {
  public readonly name = 'FfmpegComposerAgent';

  constructor(
    private readonly ffmpeg: FfmpegService,
    private readonly workingDirectory: WorkingDirectoryService,
    private readonly videoRepository: VideoRepository,
    private readonly config: VideoConfig,
    private readonly logger: Logger,
  ) {}

  public async execute(input: VideoRenderRequestDto): Promise<Result<VideoRenderResponseDto>> {
    const logger = this.logger.child({
      source: this.name,
      correlationId: input.correlationId,
      workflowRunId: input.workflowId,
      step: WorkflowStepName.Compose,
    });
    const startedAt = Date.now();
    logger.info('START', {
      sceneCount: input.plan.scenes.length,
      totalDuration: input.plan.totalDuration,
    });

    try {
      const workspace = await this.workingDirectory.prepare(input.workflowId);
      const videoDirectory = workspace.folders[WorkspaceFolder.Video];
      const outputPath = this.workingDirectory.resolve(
        workspace,
        WorkspaceFolder.Video,
        VIDEO_FILE_NAME,
      );

      const rendered = await this.ffmpeg.render(input.plan, outputPath);
      const probed = await this.ffmpeg.probe(outputPath);

      if (probed.durationMs <= 0 || probed.width <= 0) {
        throw new AgentOutputInvalidError(this.name, 'the render produced no usable video', {
          durationMs: probed.durationMs,
          width: probed.width,
        });
      }

      const stored = await this.workingDirectory.describe(
        workspace,
        WorkspaceFolder.Video,
        VIDEO_FILE_NAME,
      );

      const coverPath = await this.makeCover(workspace, input.plan);

      const video: VideoDto = {
        fileName: VIDEO_FILE_NAME,
        relativePath: stored.relativePath,
        absolutePath: stored.absolutePath,
        byteSize: stored.byteSize,
        width: probed.width,
        height: probed.height,
        fps: probed.fps,
        durationMs: probed.durationMs,
        videoCodec: probed.videoCodec,
        audioCodec: probed.audioCodec,
        renderDurationMs: rendered.renderDurationMs,
        hasBackgroundMusic: rendered.hasBackgroundMusic,
        coverPath,
      };

      await this.videoRepository.save(toNewRenderedVideo(video, input.contentId, input.workflowId));

      logger.info('SUCCESS', {
        durationMs: rendered.renderDurationMs,
        coverChosen: coverPath !== null,
        fileName: video.fileName,
        byteSize: video.byteSize,
        resolution: `${String(video.width)}x${String(video.height)}`,
        videoDurationMs: video.durationMs,
      });

      return ok({
        contentId: input.contentId,
        workflowId: input.workflowId,
        videoDirectory,
        video,
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
   * Writes the cover next to the render, or null when none could be made.
   *
   * Never fails the composition. A missing cover means the platform falls back
   * to its own first-frame grab, which is where this started — worse than a
   * chosen cover, and far better than losing a finished video over a JPEG.
   */
  private async makeCover(workspace: WorkspaceDto, plan: RenderPlanDto): Promise<string | null> {
    const source = pickCoverImage(plan.scenes, this.config.coverAtFraction);

    if (source === null) return null;

    const coverPath = this.workingDirectory.resolve(
      workspace,
      WorkspaceFolder.Video,
      COVER_FILE_NAME,
    );

    try {
      await this.ffmpeg.makeCover(source, coverPath);

      return coverPath;
    } catch (error) {
      this.logger.warn('No cover could be made; the platform will pick its own', {
        source: this.name,
        reason: error instanceof Error ? error.message : 'unknown',
      });

      return null;
    }
  }
}
