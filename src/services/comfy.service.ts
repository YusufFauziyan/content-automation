import type { MediaAssetDto } from '../dto/media.dto.js';

/**
 * Contract for image generation.
 *
 * External system: ComfyUI running a FLUX workflow.
 *
 * The service submits a prompt and writes the resulting file to `outputPath`.
 * Choosing the prompt, the size or the seed strategy is the Image Agent's job.
 */
export interface ComfyImageRequest {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  /** Fixed seed keeps a rerun of the same scene visually identical. */
  readonly seed: number;
  /** Absolute path the generated image must be written to. */
  readonly outputPath: string;
}

export interface ComfyService {
  /**
   * Generates one image and returns a reference to the written file.
   *
   * @throws {ApplicationError} Marked retryable for queue timeouts.
   */
  generateImage(request: ComfyImageRequest): Promise<MediaAssetDto>;
}
