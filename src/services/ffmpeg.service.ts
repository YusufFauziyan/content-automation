import { spawn } from 'node:child_process';

import type { VideoConfig } from '../config/app.config.js';
import {
  CameraMovement,
  TransitionEffect,
  type RenderPlanDto,
  type RenderSceneDto,
} from '../dto/render-plan.dto.js';
import { isApplicationError } from '../types/errors/application.error.js';
import {
  RenderError,
  RenderRetriesExhaustedError,
  RenderTimeoutError,
  RenderToolUnavailableError,
} from '../types/errors/render.error.js';
import type { Logger } from '../types/logger.js';
import { sleep } from '../utils/retry/sleep.js';

/** What a finished render cost and produced. */
export interface RenderResult {
  readonly renderDurationMs: number;
  readonly hasBackgroundMusic: boolean;
}

/**
 * One piece of the narration timeline: either spoken audio, or silence.
 *
 * Silence is a first-class segment because the pauses the narration plan asks
 * for have to *exist* in the file. Relying on a speech engine to breathe at a
 * paragraph break gives a different, unknowable gap every time — and subtitle
 * timing built on the planned one then drifts against it.
 */
export type AudioSegmentDto =
  | { readonly kind: 'speech'; readonly path: string }
  | { readonly kind: 'silence'; readonly seconds: number };

/** Objective properties of a media file, read back from the container. */
export interface MediaProbeResult {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoCodec: string;
  readonly audioCodec: string;
}

/**
 * Contract for rendering and inspecting media.
 *
 * External system: the FFmpeg binary.
 *
 * The service executes what the plan tells it to. It decides no timing, writes
 * no subtitles and chooses no transition — it translates a {@link RenderPlanDto}
 * into a command line and runs it. Nothing else in the application is allowed
 * to invoke FFmpeg (PROJECT_RULES.md "Service Rules").
 */
export interface FfmpegService {
  /**
   * Renders the plan to `outputPath`.
   *
   * @throws {RenderRetriesExhaustedError} When the retry budget is used up.
   * @throws {RenderToolUnavailableError} When the binary cannot be run.
   */
  render(plan: RenderPlanDto, outputPath: string): Promise<RenderResult>;

  /**
   * Joins speech and silence into one audio file.
   *
   * @throws {RenderError} When the segments cannot be assembled.
   */
  concatAudio(segments: readonly AudioSegmentDto[], outputPath: string): Promise<void>;

  /**
   * Measures what a file actually is.
   *
   * Works on audio as well as video: `durationMs` comes from the container, and
   * the video fields are simply zero for an audio-only file.
   */
  probe(filePath: string): Promise<MediaProbeResult>;
}

/** Result of running a process to completion. */
interface ProcessOutcome {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Escapes a path for use inside a filter argument.
 *
 * FFmpeg parses `filter=key=value:key=value`, so a `:` or a `'` in a path —
 * both perfectly legal on disk — silently truncates the filter into something
 * that fails with an unrelated message.
 */
export const escapeFilterPath = (path: string): string =>
  path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");

/** How much larger than the frame a still is rendered before the camera moves. */
const OVERSCAN = 2;

/**
 * Height of the coordinate space libass lays a converted SRT out in.
 *
 * FFmpeg's SRT-to-ASS conversion declares a 384x288 script and libass then
 * stretches that to the frame. Every style length below is therefore in *these*
 * units, not pixels — a `FontSize` of 18 is not 18 pixels, it is 18/288 of the
 * frame height, which on a 1920-tall video is 120 pixels and swallows the shot.
 */
const ASS_SCRIPT_HEIGHT = 288;

/**
 * Caption size as a fraction of frame height.
 *
 * Chosen so that the longest line the Subtitle Agent will emit — two lines of
 * 42 characters — fits the width without libass wrapping it onto a third.
 * Bigger text would be more striking and would break that guarantee.
 */
const SUBTITLE_HEIGHT_FRACTION = 0.026;

/** Distance from the bottom edge, as a fraction of frame height. */
const SUBTITLE_BOTTOM_FRACTION = 0.075;

/** Distance from each side, as a fraction of frame height (ASS margins are uniform units). */
const SUBTITLE_SIDE_FRACTION = 0.02;

/** Converts a fraction of the frame into the units libass expects. */
const toAssUnits = (fraction: number): number =>
  Math.max(1, Math.round(fraction * ASS_SCRIPT_HEIGHT));

/**
 * Style forced onto the burned-in subtitles: bottom, centred, at most two lines.
 *
 * `Alignment=2` is libass for bottom-centre. `WrapStyle=2` disables automatic
 * wrapping so the line breaks the Subtitle Agent decided on are the ones the
 * viewer sees — without it libass re-wraps to the frame width and a two-line
 * cue silently becomes five.
 */
export const SUBTITLE_STYLE = [
  'Alignment=2',
  'WrapStyle=2',
  `FontSize=${String(toAssUnits(SUBTITLE_HEIGHT_FRACTION))}`,
  'PrimaryColour=&H00FFFFFF',
  'OutlineColour=&H00000000',
  'BorderStyle=1',
  'Outline=1',
  'Shadow=0',
  `MarginV=${String(toAssUnits(SUBTITLE_BOTTOM_FRACTION))}`,
  `MarginL=${String(toAssUnits(SUBTITLE_SIDE_FRACTION))}`,
  `MarginR=${String(toAssUnits(SUBTITLE_SIDE_FRACTION))}`,
].join(',');

/**
 * Builds the per-scene video filter chain.
 *
 * Each input is a *single frame*: the still is scaled beyond the target so the
 * camera has somewhere to travel, and `zoompan` is what turns that one frame
 * into `d` output frames. Every scene goes through `zoompan` — including a
 * static one, at zoom 1 — because frame duplication is now its job.
 *
 * Feeding zoompan a looped image stream instead is the classic mistake this
 * replaces: `d` multiplies *per input frame*, so a five-second loop became
 * minutes of the first scene and `-shortest` ended the video before scene two
 * ever appeared.
 */
export const buildSceneFilter = (
  scene: RenderSceneDto,
  index: number,
  plan: RenderPlanDto,
): string => {
  const { width, height, fps } = plan;
  // Derived from the rounded boundaries, not the duration, so the per-scene
  // frame counts always sum to the whole timeline.
  const frames = Math.max(1, Math.round(scene.endTime * fps) - Math.round(scene.startTime * fps));
  const canvas = `scale=${String(width * OVERSCAN)}:${String(height * OVERSCAN)}:force_original_aspect_ratio=increase,crop=${String(width * OVERSCAN)}:${String(height * OVERSCAN)}`;
  const steps = [canvas, buildCameraFilter(scene, frames, width, height, fps)];

  // A fade lives inside the scene's own span, so the timeline stays exactly as
  // the plan describes it — see the class comment on why nothing overlaps.
  if (scene.transition === TransitionEffect.Fade) {
    steps.push(`fade=t=in:st=0:d=${formatSeconds(plan.transitionDuration)}`);
  } else if (scene.transition === TransitionEffect.Crossfade) {
    const out = Math.max(0, scene.duration - plan.transitionDuration);
    steps.push(`fade=t=in:st=0:d=${formatSeconds(plan.transitionDuration)}`);
    steps.push(`fade=t=out:st=${formatSeconds(out)}:d=${formatSeconds(plan.transitionDuration)}`);
  }

  steps.push(`fps=${String(fps)}`, 'setsar=1', 'format=yuv420p');

  return `[${String(index)}:v]${steps.join(',')}[v${String(index)}]`;
};

/** Formats a number of seconds for a filter argument. */
const formatSeconds = (seconds: number): string => seconds.toFixed(3);

/**
 * Builds the `zoompan` expression for one camera move.
 *
 * `on` is the output frame index and `d` the number of frames, so `on/(d-1)` is
 * progress from 0 to 1 — the one quantity every move is expressed in.
 */
const buildCameraFilter = (
  scene: RenderSceneDto,
  frames: number,
  width: number,
  height: number,
  fps: number,
): string => {
  const progress = frames > 1 ? `on/${String(frames - 1)}` : '0';
  const travel = scene.cameraSpeed;
  const zoomed = 1 + travel;

  const centreY = 'ih/2-(ih/zoom/2)';
  let zoom = String(zoomed);
  let x = 'iw/2-(iw/zoom/2)';
  const y = centreY;

  switch (scene.cameraMovement) {
    case CameraMovement.Static:
      zoom = '1';
      break;
    case CameraMovement.ZoomIn:
      zoom = `1+${String(travel)}*${progress}`;
      break;
    case CameraMovement.ZoomOut:
      zoom = `${String(zoomed)}-${String(travel)}*${progress}`;
      break;
    case CameraMovement.PanLeft:
      x = `(iw-iw/zoom)*(1-${progress})`;
      break;
    case CameraMovement.PanRight:
      x = `(iw-iw/zoom)*${progress}`;
      break;
  }

  return [
    `zoompan=z='${zoom}'`,
    `x='${x}'`,
    `y='${y}'`,
    `d=${String(frames)}`,
    `s=${String(width)}x${String(height)}`,
    `fps=${String(fps)}`,
  ].join(':');
};

/**
 * Builds the whole filter graph for a plan.
 *
 * Exported so the graph can be asserted in a unit test without running FFmpeg:
 * it is the part of rendering most likely to be wrong and least pleasant to
 * debug from a process exit code.
 */
export const buildFilterGraph = (plan: RenderPlanDto): string => {
  const scenes = plan.scenes.map((scene, index) => buildSceneFilter(scene, index, plan));
  const labels = plan.scenes.map((_scene, index) => `[v${String(index)}]`).join('');
  const concat = `${labels}concat=n=${String(plan.scenes.length)}:v=1:a=0[vcat]`;
  const burn = `[vcat]subtitles='${escapeFilterPath(plan.subtitlePath)}':force_style='${SUBTITLE_STYLE}'[vout]`;

  return [...scenes, concat, burn].join(';');
};

/**
 * Builds the audio graph.
 *
 * The narration is always padded with trailing silence (`apad`): the subtitle
 * timeline includes the planned pauses, so the video is slightly longer than
 * the raw voice track, and without padding `-shortest` would cut the final
 * scene off mid-image. With it, the *video* decides the length.
 *
 * A missing music bed is the ordinary case, not a failure: the narration is
 * simply padded and mapped through alone.
 */
export const buildAudioGraph = (plan: RenderPlanDto, narrationIndex: number): string => {
  if (plan.audio.backgroundMusicPath === null) {
    return `[${String(narrationIndex)}:a]apad[aout]`;
  }

  const musicIndex = narrationIndex + 1;

  return [
    `[${String(narrationIndex)}:a]volume=1[narration]`,
    `[${String(musicIndex)}:a]volume=${plan.audio.backgroundMusicVolume.toFixed(3)}[music]`,
    // `duration=first` keeps the bed only under actual speech; the padding
    // afterwards carries the tail of the timeline in silence.
    '[narration][music]amix=inputs=2:duration=first:dropout_transition=0[amixed]',
    '[amixed]apad[aout]',
  ].join(';');
};

/**
 * Builds the full argument list for a render.
 *
 * Exported for the same reason as the filter graph: asserting the arguments is
 * how the encoder settings are proven to come from configuration rather than
 * from a constant somebody typed.
 */
export const buildRenderArguments = (
  plan: RenderPlanDto,
  outputPath: string,
  config: VideoConfig,
): readonly string[] => {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];

  // One frame per image: zoompan generates the scene's frames from it, so the
  // input must not be looped (see buildSceneFilter).
  for (const scene of plan.scenes) {
    args.push('-i', scene.imagePath);
  }

  const narrationIndex = plan.scenes.length;
  args.push('-i', plan.audio.narrationPath);

  if (plan.audio.backgroundMusicPath !== null) {
    // Looped so a short bed still covers a long narration.
    args.push('-stream_loop', '-1', '-i', plan.audio.backgroundMusicPath);
  }

  const graph = `${buildFilterGraph(plan)};${buildAudioGraph(plan, narrationIndex)}`;

  args.push('-filter_complex', graph, '-map', '[vout]', '-map', '[aout]');

  args.push(
    '-c:v',
    config.videoCodec,
    '-preset',
    config.preset,
    '-crf',
    String(config.crf),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(plan.fps),
    '-c:a',
    config.audioCodec,
    '-b:a',
    '192k',
    // The plan is the authority on length. An explicit -t is used instead of
    // -shortest because the padded (infinite) audio comes out of the filter
    // graph, and -shortest against a filtered stream keeps encoding silence
    // far past the video's end on ffmpeg 5.x — the muxer only stops when EOF
    // reaches it, which apad never sends.
    '-t',
    formatSeconds(plan.totalDuration),
    '-movflags',
    '+faststart',
    outputPath,
  );

  return args;
};

/**
 * Sample rate and layout every audio segment is normalised to before joining.
 *
 * `concat` refuses inputs whose formats differ, and a silence generated at one
 * rate will not splice onto speech produced at another. 48 kHz is chosen so
 * that a 24 kHz engine like Kokoro is upsampled rather than a higher-rate one
 * being degraded.
 */
const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_CHANNEL_LAYOUT = 'mono';

/**
 * Builds the argument list that joins the narration segments.
 *
 * Exported so the graph can be asserted without running FFmpeg.
 */
export const buildConcatAudioArguments = (
  segments: readonly AudioSegmentDto[],
  outputPath: string,
): readonly string[] => {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];

  for (const segment of segments) {
    if (segment.kind === 'speech') {
      args.push('-i', segment.path);
    } else {
      args.push(
        '-f',
        'lavfi',
        '-t',
        segment.seconds.toFixed(3),
        '-i',
        `anullsrc=channel_layout=${AUDIO_CHANNEL_LAYOUT}:sample_rate=${String(AUDIO_SAMPLE_RATE)}`,
      );
    }
  }

  const normalised = segments.map(
    (_segment, index) =>
      `[${String(index)}:a]aresample=${String(AUDIO_SAMPLE_RATE)},aformat=channel_layouts=${AUDIO_CHANNEL_LAYOUT}[a${String(index)}]`,
  );
  const labels = segments.map((_segment, index) => `[a${String(index)}]`).join('');
  const graph = `${normalised.join(';')};${labels}concat=n=${String(segments.length)}:v=0:a=1[aout]`;

  args.push(
    '-filter_complex',
    graph,
    '-map',
    '[aout]',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    outputPath,
  );

  return args;
};

/** Shape of the `ffprobe -of json` answer this service reads. */
interface ProbePayload {
  readonly format?: { readonly duration?: string };
  readonly streams?: readonly {
    readonly codec_type?: string;
    readonly codec_name?: string;
    readonly width?: number;
    readonly height?: number;
    readonly avg_frame_rate?: string;
  }[];
}

/** Parses ffprobe's `30000/1001` frame-rate notation. */
export const parseFrameRate = (value: string | undefined): number => {
  if (value === undefined) {
    return 0;
  }

  const [numerator, denominator] = value.split('/').map(Number);

  if (numerator === undefined || denominator === undefined || denominator === 0) {
    return 0;
  }

  return Math.round(numerator / denominator);
};

/**
 * Process implementation of {@link FfmpegService}.
 *
 * Scenes are concatenated rather than overlapped. A true A/B dissolve needs the
 * neighbouring segments to share time, which shortens the video by one
 * transition per cut and pulls every later scene away from the timeline the
 * plan — and the subtitle file — were built on. Keeping the timeline exact was
 * worth more than the dissolve: `crossfade` is therefore rendered as a fade
 * out into a fade in, entirely inside the two scenes' own spans.
 */
export class ProcessFfmpegService implements FfmpegService {
  /** Filters this build offers, read once and remembered. */
  private available: Set<string> | null = null;

  constructor(
    private readonly config: VideoConfig,
    private readonly logger: Logger,
  ) {}

  public async render(plan: RenderPlanDto, outputPath: string): Promise<RenderResult> {
    await this.assertCanBurnSubtitles();

    const args = buildRenderArguments(plan, outputPath, this.config);
    const maxAttempts = this.config.retry.maxRetries + 1;
    let lastError: unknown;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsMade = attempt;
      const startedAt = Date.now();

      try {
        await this.run(this.config.ffmpegPath, args, this.config.timeoutMs);

        return {
          renderDurationMs: Date.now() - startedAt,
          hasBackgroundMusic: plan.audio.backgroundMusicPath !== null,
        };
      } catch (error) {
        lastError = error;

        if (!isApplicationError(error) || !error.retryable || attempt === maxAttempts) {
          break;
        }

        const delayMs = this.delayForRetry(attempt);
        this.logger.warn('Render failed, retrying', {
          source: ProcessFfmpegService.name,
          retryCount: attempt,
          delayMs,
        });
        await sleep(delayMs);
      }
    }

    if (isApplicationError(lastError) && lastError.retryable) {
      throw new RenderRetriesExhaustedError(attemptsMade, lastError);
    }

    throw lastError;
  }

  public async concatAudio(
    segments: readonly AudioSegmentDto[],
    outputPath: string,
  ): Promise<void> {
    if (segments.length === 0) {
      throw new RenderError('Cannot assemble narration from no segments.', false);
    }

    await this.run(
      this.config.ffmpegPath,
      buildConcatAudioArguments(segments, outputPath),
      this.config.timeoutMs,
    );
  }

  public async probe(filePath: string): Promise<MediaProbeResult> {
    const outcome = await this.run(
      this.config.ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate',
        '-of',
        'json',
        filePath,
      ],
      this.config.timeoutMs,
    );

    let payload: ProbePayload;
    try {
      payload = JSON.parse(outcome.stdout) as ProbePayload;
    } catch {
      throw new RenderError('ffprobe returned output that is not JSON.', false, {
        preview: outcome.stdout.slice(0, 200),
      });
    }

    const video = payload.streams?.find((stream) => stream.codec_type === 'video');
    const audio = payload.streams?.find((stream) => stream.codec_type === 'audio');

    return {
      durationMs: Math.round(Number(payload.format?.duration ?? 0) * 1000),
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      fps: parseFrameRate(video?.avg_frame_rate),
      videoCodec: video?.codec_name ?? '',
      audioCodec: audio?.codec_name ?? '',
    };
  }

  /**
   * Refuses to start a render this build cannot finish.
   *
   * Burning captions needs the `subtitles` filter, which only exists when
   * FFmpeg was built with libass — and several common builds, Homebrew's among
   * them, are not. Discovering that from a filter-graph error after minutes of
   * encoding wastes the render and reads like a bug in the graph; discovering
   * it first names the actual problem and the fix.
   */
  private async assertCanBurnSubtitles(): Promise<void> {
    this.available ??= await this.readFilters();

    if (!this.available.has('subtitles')) {
      throw new RenderToolUnavailableError(
        this.config.ffmpegPath,
        'this build has no "subtitles" filter, so captions cannot be burned in. ' +
          'Install an FFmpeg built with libass (Debian and Ubuntu packages include it).',
      );
    }
  }

  /** Lists the filters this build offers. */
  private async readFilters(): Promise<Set<string>> {
    const outcome = await this.run(this.config.ffmpegPath, ['-hide_banner', '-filters'], 30_000);

    return new Set(
      outcome.stdout
        .split('\n')
        .map((line) => line.trim().split(/\s+/u)[1])
        .filter((name): name is string => name !== undefined),
    );
  }

  /**
   * Runs one process to completion, mapping every failure onto a typed error.
   *
   * FFmpeg reports what went wrong on stderr and says nothing useful in its
   * exit code, so the tail of stderr is what the error carries.
   */
  private async run(
    binary: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<ProcessOutcome> {
    const outcome = await new Promise<ProcessOutcome>((resolve, reject) => {
      const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          error.code === 'ENOENT'
            ? new RenderToolUnavailableError(binary, 'binary not found')
            : new RenderToolUnavailableError(binary, error.message),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
          reject(new RenderTimeoutError(timeoutMs));
          return;
        }

        resolve({ code, stdout, stderr });
      });
    });

    if (outcome.code !== 0) {
      throw new RenderError(
        `${binary} exited with code ${String(outcome.code)}.`,
        // A non-zero exit is almost always a malformed graph or a missing
        // input, and neither improves by running the same command again.
        false,
        { exitCode: outcome.code, stderr: outcome.stderr.trim().slice(-500) },
      );
    }

    return outcome;
  }

  /** Backoff for the given 1-based retry number, reusing the last delay if needed. */
  private delayForRetry(retryNumber: number): number {
    const { backoffMs } = this.config.retry;
    return backoffMs[retryNumber - 1] ?? backoffMs[backoffMs.length - 1] ?? 0;
  }
}
