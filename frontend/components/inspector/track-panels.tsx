'use client';

import { Captions, Download, Mic } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Run } from '@/lib/types';
import { formatBytes } from '@/lib/utils';

/**
 * The narration track, playable in place.
 *
 * Listening is the only way to judge a voice, and a link that downloads a file
 * you then open in another application is not listening — it is a detour.
 */
export function AudioPanel({ run }: { run: Run }) {
  if (!run.audio) {
    return <Empty icon={Mic} message="No narration yet. It appears once the voice step succeeds." />;
  }

  const blocks = run.scenes.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[12px] border border-white/8 bg-sunk p-3">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the captions
            are the subtitle track, shown in its own panel. */}
        <audio src={run.audio.url} controls preload="metadata" className="w-full" />
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="File" value="narration.mp3" />
        <Stat label="Size" value={formatBytes(run.audio.byteSize)} />
        <Stat label="Scenes" value={String(blocks)} />
        <Stat label="Timing" value="measured" />
      </dl>

      <p className="text-[11.5px] leading-relaxed text-dim">
        Each narration block was spoken separately and measured, then joined with exactly the silence
        the plan asks for. That is why the captions cannot drift from the voice.
      </p>

      <Button variant="outline" onClick={() => window.open(run.audio?.url, '_blank')}>
        <Download size={13} /> Download the audio
      </Button>
    </div>
  );
}

/**
 * The captions, as text.
 *
 * They are burned into the video, so once it is rendered there is no way to
 * check them except by watching. Reading them here is faster, and the timings
 * are what actually go wrong.
 */
export function SubtitlePanel({ run }: { run: Run }) {
  const [active, setActive] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  if (!run.subtitle) {
    return (
      <Empty icon={Captions} message="No subtitles yet. They appear once the subtitle step succeeds." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Cues" value={String(run.subtitle.cues.length)} />
        <Stat label="Size" value={formatBytes(run.subtitle.byteSize)} />
      </dl>

      <ol ref={list} className="flex flex-col gap-1">
        {run.subtitle.cues.map((cue) => (
          <li key={cue.index}>
            <button
              type="button"
              onClick={() => setActive(active === cue.index ? null : cue.index)}
              className={`w-full rounded-[8px] border px-2.5 py-2 text-left transition-colors ${
                active === cue.index
                  ? 'border-accent/40 bg-accent/8'
                  : 'border-white/6 bg-rise/40 hover:bg-rise'
              }`}
            >
              <span className="mono block text-[10px] text-faint">{cue.time}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-dim">{cue.text}</span>
            </button>
          </li>
        ))}
      </ol>

      <Button variant="outline" onClick={() => window.open(run.subtitle?.url, '_blank')}>
        <Download size={13} /> Download the .srt
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/8 bg-rise/50 px-3 py-2">
      <dt className="text-[10px] text-faint">{label}</dt>
      <dd className="num mt-0.5 text-[12.5px] text-ink">{value}</dd>
    </div>
  );
}

function Empty({ icon: Icon, message }: { icon: typeof Mic; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-11 text-center">
      <Icon size={26} className="text-faint" strokeWidth={1.5} />
      <p className="text-[12px] leading-relaxed text-faint">{message}</p>
    </div>
  );
}
