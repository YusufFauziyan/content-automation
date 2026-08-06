import { describe, expect, it } from 'vitest';

import type { VideoConfig } from '../../../src/config/app.config.js';
import {
  CameraMovement,
  TransitionEffect,
  type RenderPlanDto,
  type RenderSceneDto,
} from '../../../src/dto/render-plan.dto.js';
import {
  buildAudioGraph,
  buildFilterGraph,
  buildRenderArguments,
  buildSceneFilter,
  escapeFilterPath,
  parseFrameRate,
  toSubtitleStyle,
} from '../../../src/services/ffmpeg.service.js';

const config: VideoConfig = {
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  preset: 'medium',
  crf: 23,
  cameraIntensity: 0.12,
  transitionSeconds: 0.5,
  subtitleBottomFraction: 0.16,
  coverAtFraction: 0.35,
  timeoutMs: 900_000,
  retry: { maxRetries: 2, backoffMs: [1, 1] },
};

const scene = (
  number: number,
  cameraMovement: CameraMovement = CameraMovement.Static,
  transition: TransitionEffect = TransitionEffect.Cut,
): RenderSceneDto => ({
  scene: number,
  imagePath: `/tmp/images/scene-00${String(number)}.png`,
  startTime: (number - 1) * 5,
  endTime: number * 5,
  duration: 5,
  cameraMovement,
  cameraSpeed: 0.12,
  transition,
  subtitleStart: (number - 1) * 5,
  subtitleEnd: number * 5,
  subtitleText: `Line ${String(number)}`,
});

const plan = (
  scenes: readonly RenderSceneDto[],
  musicPath: string | null = null,
): RenderPlanDto => ({
  contentId: 'content-1',
  workflowId: 'workflow-1',
  width: config.width,
  height: config.height,
  fps: config.fps,
  totalDuration: scenes.length * 5,
  scenes,
  audio: {
    narrationPath: '/tmp/audio/narration.mp3',
    backgroundMusicPath: musicPath,
    backgroundMusicVolume: 0.12,
  },
  subtitlePath: '/tmp/subtitle/subtitle.srt',
  transitionDuration: config.transitionSeconds,
});

describe('escapeFilterPath', () => {
  it('escapes the separator FFmpeg uses between filter options', () => {
    expect(escapeFilterPath('/tmp/a:b/sub.srt')).toBe('/tmp/a\\:b/sub.srt');
  });

  it('escapes quotes', () => {
    expect(escapeFilterPath("/tmp/it's/sub.srt")).toBe("/tmp/it\\'s/sub.srt");
  });

  it('leaves an ordinary path alone', () => {
    expect(escapeFilterPath('/tmp/subtitle/subtitle.srt')).toBe('/tmp/subtitle/subtitle.srt');
  });
});

describe('parseFrameRate', () => {
  it('reads a whole rate', () => {
    expect(parseFrameRate('30/1')).toBe(30);
  });

  it('rounds a fractional rate', () => {
    expect(parseFrameRate('30000/1001')).toBe(30);
  });

  it('treats a missing or degenerate rate as zero', () => {
    expect(parseFrameRate(undefined)).toBe(0);
    expect(parseFrameRate('0/0')).toBe(0);
  });
});

describe('buildSceneFilter', () => {
  it('duplicates a static scene through zoompan at zoom one', () => {
    // zoompan is what turns the single input frame into the scene's frames,
    // so even a static scene needs it — at zoom 1, centred.
    const filter = buildSceneFilter(scene(1), 0, plan([scene(1)]));

    expect(filter).toContain("zoompan=z='1'");
    expect(filter).toContain('d=150');
    expect(filter).toContain('s=1080x1920');
  });

  it('derives the frame count from the scene boundaries', () => {
    // 5 seconds at 30fps: frames come from round(end*fps) - round(start*fps),
    // so consecutive scenes always sum to the whole timeline.
    const filter = buildSceneFilter(scene(2), 1, plan([scene(1), scene(2)]));

    expect(filter).toContain('d=150');
  });

  it('zooms in from the plan, not from a constant', () => {
    const filter = buildSceneFilter(scene(1, CameraMovement.ZoomIn), 0, plan([scene(1)]));

    expect(filter).toContain('zoompan');
    expect(filter).toContain("z='1+0.12*on/149'");
  });

  it('zooms out in the opposite direction', () => {
    const filter = buildSceneFilter(scene(1, CameraMovement.ZoomOut), 0, plan([scene(1)]));

    expect(filter).toContain("z='1.12-0.12*on/149'");
  });

  it('pans right by advancing x across the frame', () => {
    const filter = buildSceneFilter(scene(1, CameraMovement.PanRight), 0, plan([scene(1)]));

    expect(filter).toContain("x='(iw-iw/zoom)*on/149'");
  });

  it('pans left by retreating x across the frame', () => {
    const filter = buildSceneFilter(scene(1, CameraMovement.PanLeft), 0, plan([scene(1)]));

    expect(filter).toContain("x='(iw-iw/zoom)*(1-on/149)'");
  });

  it('adds no fade to a cut', () => {
    const filter = buildSceneFilter(scene(1), 0, plan([scene(1)]));

    expect(filter).not.toContain('fade=');
  });

  it('fades in for a fade transition', () => {
    const filter = buildSceneFilter(
      scene(1, CameraMovement.Static, TransitionEffect.Fade),
      0,
      plan([scene(1)]),
    );

    expect(filter).toContain('fade=t=in:st=0:d=0.500');
    expect(filter).not.toContain('t=out');
  });

  it('fades both ways for a crossfade, inside the scene own span', () => {
    const filter = buildSceneFilter(
      scene(1, CameraMovement.Static, TransitionEffect.Crossfade),
      0,
      plan([scene(1)]),
    );

    expect(filter).toContain('fade=t=in:st=0:d=0.500');
    expect(filter).toContain('fade=t=out:st=4.500:d=0.500');
  });

  it('labels its output by input index', () => {
    expect(buildSceneFilter(scene(2), 1, plan([scene(1), scene(2)]))).toContain('[v1]');
  });
});

describe('buildFilterGraph', () => {
  it('concatenates every scene', () => {
    const graph = buildFilterGraph(plan([scene(1), scene(2), scene(3)]), 0.16);

    expect(graph).toContain('[v0][v1][v2]concat=n=3:v=1:a=0[vcat]');
  });

  it('burns the subtitles onto the concatenated stream', () => {
    const graph = buildFilterGraph(plan([scene(1)]), 0.16);

    expect(graph).toContain("[vcat]subtitles='/tmp/subtitle/subtitle.srt'");
    expect(graph).toContain('[vout]');
  });

  it('positions the subtitles at the bottom, centred', () => {
    // Alignment=2 is libass for bottom-centre; MarginV lifts it off the edge.
    expect(toSubtitleStyle(0.16)).toContain('Alignment=2');
    expect(toSubtitleStyle(0.16)).toMatch(/MarginV=\d+/u);
  });

  it('lifts the caption further when configured to', () => {
    // The right height is not a property of the video but of wherever it is
    // watched: TikTok draws its own caption and handle over the bottom of the
    // frame, and burned-in text placed for a bare file lands underneath them.
    const margin = (fraction: number): number =>
      Number(/MarginV=(\d+)/u.exec(toSubtitleStyle(fraction))?.[1]);

    expect(margin(0.16)).toBeGreaterThan(margin(0.075));
  });

  it('keeps a cue to the lines the subtitle agent chose', () => {
    // Without this libass re-wraps to the frame width and a two-line cue
    // silently becomes five.
    expect(toSubtitleStyle(0.16)).toContain('WrapStyle=2');
  });

  it('sizes the caption as a fraction of the frame, not in pixels', () => {
    // libass lays a converted SRT out in a 288-tall space, so a plausible-
    // looking pixel value here would render several times too large.
    const size = /FontSize=(\d+)/u.exec(toSubtitleStyle(0.16))?.[1];

    expect(Number(size)).toBeGreaterThan(0);
    expect(Number(size)).toBeLessThan(20);
  });
});

describe('buildAudioGraph', () => {
  it('pads the bare narration with silence when there is no music', () => {
    // The video timeline includes the planned pauses, so it outlives the raw
    // voice track; without padding, -shortest would cut the final scene.
    expect(buildAudioGraph(plan([scene(1)]), 1)).toBe('[1:a]apad[aout]');
  });

  it('mixes music under the narration at the configured volume', () => {
    const graph = buildAudioGraph(plan([scene(1)], '/tmp/music/bed.mp3'), 1);

    expect(graph).toContain('[1:a]volume=1[narration]');
    expect(graph).toContain('[2:a]volume=0.120[music]');
    expect(graph).toContain('amix=inputs=2:duration=first');
    expect(graph).toContain('apad[aout]');
  });
});

describe('buildRenderArguments', () => {
  it('feeds every scene image exactly once, as a single frame', () => {
    // Looping the image here is the bug this pins down: zoompan multiplies per
    // input frame, so a looped input froze the video on scene one.
    const args = buildRenderArguments(plan([scene(1), scene(2)]), '/tmp/out.mp4', config);
    const inputs = args.filter((arg) => arg.endsWith('.png'));

    expect(inputs).toEqual(['/tmp/images/scene-001.png', '/tmp/images/scene-002.png']);
    expect(args).not.toContain('-loop');
  });

  it('takes every encoder setting from configuration', () => {
    const args = buildRenderArguments(plan([scene(1)]), '/tmp/out.mp4', config);

    expect(args).toContain('libx264');
    expect(args).toContain('medium');
    expect(args).toContain('23');
    expect(args).toContain('aac');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('maps the padded narration when there is no music', () => {
    const args = buildRenderArguments(plan([scene(1), scene(2)]), '/tmp/out.mp4', config);
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';

    // Two images, so the narration is input 2 — padded, then mapped.
    expect(graph).toContain('[2:a]apad[aout]');
    expect(args).toContain('[aout]');
  });

  it('loops the music bed so a short track still covers the narration', () => {
    const args = buildRenderArguments(
      plan([scene(1)], '/tmp/music/bed.mp3'),
      '/tmp/out.mp4',
      config,
    );

    expect(args).toContain('-stream_loop');
    expect(args).toContain('[aout]');
  });

  it('cuts the output at exactly the planned length', () => {
    // -shortest is deliberately absent: the padded audio is infinite and comes
    // from the filter graph, and -shortest against a filtered stream encodes
    // silence far past the video's end. The plan's own duration is the stop.
    const args = buildRenderArguments(plan([scene(1)]), '/tmp/out.mp4', config);
    const timeIndex = args.lastIndexOf('-t');

    expect(args).not.toContain('-shortest');
    expect(args[timeIndex + 1]).toBe('5.000');
  });

  it('writes a file players can start before it is fully downloaded', () => {
    const args = buildRenderArguments(plan([scene(1)]), '/tmp/out.mp4', config);

    expect(args).toContain('+faststart');
    expect(args).toContain('yuv420p');
  });
});
