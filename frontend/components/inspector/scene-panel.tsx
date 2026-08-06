'use client';

import { Check, Copy, Layers, MoveRight } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { useRun } from '@/lib/store';
import type { Run } from '@/lib/types';

/** Camera moves, as words rather than the enum spelling. */
const CAMERA: Record<string, string> = {
  STATIC: 'Static',
  ZOOM_IN: 'Zoom in',
  ZOOM_OUT: 'Zoom out',
  PAN_LEFT: 'Pan left',
  PAN_RIGHT: 'Pan right',
};

const TRANSITION: Record<string, string> = {
  CUT: 'Cut',
  FADE: 'Fade',
  CROSSFADE: 'Crossfade',
};

/**
 * The shot list, as the Scene Agent planned it.
 *
 * This is the document the rest of the pipeline is built from: the narration
 * comes from these lines, the stills from these briefs, and the video's length
 * from these durations. Until now it was only visible as the numbers on other
 * panels, which meant the one artefact you would want to check before spending
 * minutes rendering was the one you could not read.
 */
export function ScenePanel({ run }: { run: Run }) {
  const { toast } = useRun();
  const [copied, setCopied] = useState(false);

  if (run.scenes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 px-5 py-11 text-center">
        <Layers size={26} className="text-faint" strokeWidth={1.5} />
        <p className="text-[12px] leading-relaxed text-faint">
          No scene plan yet. It appears once the scene step succeeds.
        </p>
      </div>
    );
  }

  const total = run.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);

  /** The whole plan as text, for reading somewhere other than this panel. */
  const copyPlan = async () => {
    const text = run.scenes
      .map(
        (scene) =>
          `Scene ${String(scene.scene).padStart(2, '0')} — ${scene.durationSeconds}s` +
          `\nNarration: ${scene.caption}` +
          `\nImage: ${scene.prompt}`,
      )
      .join('\n\n');

    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast('error', 'The browser would not let us copy.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Scenes" value={String(run.scenes.length)} />
        <Stat label="Planned length" value={`${total.toFixed(1)}s`} />
      </div>

      <Button size="sm" variant="outline" onClick={() => void copyPlan()}>
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied the plan' : 'Copy the whole plan'}
      </Button>

      <ol className="flex flex-col gap-2">
        {run.scenes.map((scene) => (
          <li
            key={scene.scene}
            className="rounded-[12px] border border-white/8 bg-rise/40 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="num text-[11px] font-medium text-ink">
                Scene {String(scene.scene).padStart(2, '0')}
              </span>
              <span className="num text-[10px] text-faint">{scene.durationSeconds}s</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-faint">
                {CAMERA[scene.camera] ?? scene.camera}
                <MoveRight size={9} />
                {TRANSITION[scene.transition] ?? scene.transition}
              </span>
            </div>

            <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">{scene.caption}</p>

            <details className="group mt-1.5">
              <summary className="cursor-pointer list-none text-[10px] text-faint hover:text-dim">
                <span className="group-open:hidden">Image brief</span>
                <span className="hidden group-open:inline">Hide brief</span>
              </summary>
              <p className="mono mt-1 max-h-[3.4rem] overflow-y-auto text-[10px] leading-relaxed text-faint">
                {scene.prompt}
              </p>
            </details>
          </li>
        ))}
      </ol>

      <p className="text-[10.5px] leading-relaxed text-faint">
        Style: <span className="text-dim">{run.scenes[0]?.style ?? '—'}</span>. Camera moves and
        transitions are instructions, not hints — the renderer performs exactly what is written
        here.
      </p>
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
