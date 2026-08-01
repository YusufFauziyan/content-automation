import type { ScenePlanDto } from './scene.dto.js';
import type { SubtitleDto } from './subtitle.dto.js';
import type { VideoDto } from './video.dto.js';

/** Verdict of the QA Agent. Nothing is uploaded unless the verdict is PASS. */
export enum QualityVerdict {
  Pass = 'PASS',
  Fail = 'FAIL',
}

/** Individual property the QA Agent asserts. */
export enum QualityCheckName {
  AspectRatio = 'ASPECT_RATIO',
  Resolution = 'RESOLUTION',
  Duration = 'DURATION',
  AudioPresent = 'AUDIO_PRESENT',
  SubtitlePresent = 'SUBTITLE_PRESENT',
  SceneCount = 'SCENE_COUNT',
}

/** Input for the QA Agent. */
export interface QualityRequestDto {
  readonly video: VideoDto;
  readonly scenePlan: ScenePlanDto;
  readonly subtitles: SubtitleDto;
}

/** Result of one assertion. */
export interface QualityCheckDto {
  readonly name: QualityCheckName;
  readonly passed: boolean;
  /** Why the check failed; `null` when it passed. */
  readonly reason: string | null;
}

/** Output of the QA Agent. */
export interface QualityReportDto {
  readonly verdict: QualityVerdict;
  readonly checks: readonly QualityCheckDto[];
}
