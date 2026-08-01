import type { UploadDto, UploadRequestDto } from '../dto/upload.dto.js';
import type { Agent } from '../types/agent.js';

/**
 * Publishes the video and confirms it is live.
 *
 * Purpose
 * - Upload the rendered video, then verify that the published URL is reachable
 *   before reporting success.
 *
 * Input
 * - {@link UploadRequestDto}
 *
 * Output
 * - {@link UploadDto} — status `VERIFIED` and the public URL.
 *
 * Dependencies
 * - `PlaywrightService` — performs and verifies the upload.
 * - `UploadRepository` — records the attempt and its result.
 *
 * Verification is not optional: the Cleanup Agent deletes the only copy of the
 * video, so an unverified upload would lose the work permanently.
 */
export type UploadAgent = Agent<UploadRequestDto, UploadDto>;
