import type { QualityReportDto, QualityRequestDto } from '../dto/quality.dto.js';
import type { Agent } from '../types/agent.js';

/**
 * Decides whether the rendered video may be published.
 *
 * Purpose
 * - Assert aspect ratio, resolution, duration, audio presence, subtitle
 *   presence and scene count, and return a single verdict.
 *
 * Input
 * - {@link QualityRequestDto}
 *
 * Output
 * - {@link QualityReportDto} — `PASS` or `FAIL`, with a reason per failed check.
 *
 * Dependencies
 * - `FfmpegService` — probes the rendered file.
 *
 * This is the last gate before publication: a `FAIL` verdict must abort the
 * run, never merely warn.
 */
export type QaAgent = Agent<QualityRequestDto, QualityReportDto>;
