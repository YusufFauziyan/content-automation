'use client';

import { AlertTriangle, Check, Download, Film } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Run } from '@/lib/types';
import { cn, formatBytes, formatDuration } from '@/lib/utils';

/**
 * Review panel for the finished video.
 *
 * Reviewing is checking, not admiring, so the panel puts the two numbers that
 * actually go wrong next to the player: how long the audio is, and how long the
 * subtitle timeline is. When they disagree the captions drift, and that is
 * invisible until someone watches the last ten seconds.
 */
export function VideoPanel({ run }: { run: Run }) {
  const video = useRef<HTMLVideoElement>(null);
  const [approved, setApproved] = useState(false);

  if (!run.video) {
    return (
      <div className="flex flex-col items-center gap-2.5 px-5 py-11 text-center">
        <Film size={26} className="text-faint" strokeWidth={1.5} />
        <p className="text-[12px] text-faint">
          No video yet.
          <br />
          It appears here once rendering succeeds.
        </p>
      </div>
    );
  }

  const drift = Math.abs(run.video.audioDurationMs - run.video.subtitleDurationMs);
  const inSync = drift <= 120;

  const jump = (seconds: number) => {
    if (video.current) {
      video.current.currentTime = seconds;
      void video.current.play();
    }
  };

  let elapsed = 0;
  const marks = run.scenes.map((scene) => {
    const at = elapsed;
    elapsed += scene.durationSeconds;
    return { scene: scene.scene, at, caption: scene.caption };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black">
        <video
          ref={video}
          src={run.video.url}
          controls
          playsInline
          preload="metadata"
          className="mx-auto block max-h-[320px] w-auto"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Resolution" value={`${run.video.width}×${run.video.height}`} />
        <Stat label="Duration" value={formatDuration(run.video.durationMs)} />
        <Stat label="Size" value={formatBytes(run.video.byteSize)} />
        <Stat label="Cues" value={String(run.video.cueCount)} />
      </div>

      <div
        className={cn(
          'rounded-[12px] border px-3.5 py-3',
          inSync ? 'border-ok/25 bg-ok/8' : 'border-warn/25 bg-warn/8',
        )}
      >
        <div className="flex items-center gap-2">
          {inSync ? (
            <Check size={14} className="shrink-0 text-ok" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 text-warn" />
          )}
          <p className="text-[12px] font-medium text-ink">
            {inSync ? 'Subtitles track the audio' : 'Subtitles drift from the audio'}
          </p>
        </div>
        <dl className="num mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <dt className="text-faint">Audio</dt>
            <dd className="text-dim">{(run.video.audioDurationMs / 1000).toFixed(3)}s</dd>
          </div>
          <div>
            <dt className="text-faint">Subtitles</dt>
            <dd className="text-dim">{(run.video.subtitleDurationMs / 1000).toFixed(3)}s</dd>
          </div>
          <div>
            <dt className="text-faint">Difference</dt>
            <dd className={inSync ? 'text-ok' : 'text-warn'}>{(drift / 1000).toFixed(3)}s</dd>
          </div>
        </dl>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-faint">
          Jump to a scene
        </p>
        <div className="flex flex-col gap-1">
          {marks.map((mark) => (
            <button
              key={mark.scene}
              onClick={() => jump(mark.at)}
              className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-rise"
            >
              <span className="num mt-px shrink-0 text-[10.5px] text-accent-hi">
                {String(Math.floor(mark.at / 60)).padStart(2, '0')}:
                {String(Math.floor(mark.at % 60)).padStart(2, '0')}
              </span>
              <span className="line-clamp-1 text-[11px] text-dim">{mark.caption}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 border-t border-white/6 pt-3">
        <Button
          variant={approved ? 'default' : 'primary'}
          className="flex-1"
          onClick={() => setApproved(true)}
          disabled={approved}
        >
          <Check size={13} /> {approved ? 'Approved for upload' : 'Approve'}
        </Button>
        <Button
          variant="outline"
          aria-label="Download the rendered video"
          onClick={() => window.open(run.video?.url, '_blank')}
        >
          <Download size={13} />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/8 bg-rise/50 px-3 py-2">
      <p className="text-[10px] text-faint">{label}</p>
      <p className="num mt-0.5 text-[12.5px] text-ink">{value}</p>
    </div>
  );
}
