import type { CleanupReportDto, CleanupRequestDto } from '../dto/cleanup.dto.js';
import type { Agent } from '../types/agent.js';

/**
 * Deletes every disposable artefact of a run.
 *
 * Purpose
 * - Remove the images, audio, subtitles, video and temporary JSON produced by
 *   the run, once the upload has been verified.
 *
 * Input
 * - {@link CleanupRequestDto}
 *
 * Output
 * - {@link CleanupReportDto}
 *
 * Dependencies
 * - `FileSystemService` — performs the deletions.
 *
 * Never deletes metadata, embeddings or logs. Refuses to run when the upload is
 * not verified (CLAUDE.md "Media Lifecycle").
 */
export type CleanupAgent = Agent<CleanupRequestDto, CleanupReportDto>;
