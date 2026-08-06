'use client';

import { ChevronDown, Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ResizeHandle } from '@/components/ui/resize-handle';
import { useResizable } from '@/lib/use-resizable';
import { STEPS, type Run } from '@/lib/types';
import { cn, formatClock } from '@/lib/utils';

/**
 * Height bounds.
 *
 * The floor keeps the header plus a few readable lines. The ceiling is worked
 * out from the window rather than fixed, so the console can never grow past
 * half the height and leave the canvas as a sliver.
 */
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 186;
const COLLAPSED_HEIGHT = 38;
const maxHeight = () => Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.6));

const LEVEL_TONE = {
  INFO: 'text-node-media',
  DEBUG: 'text-faint',
  WARN: 'text-warn',
  ERROR: 'text-err',
} as const;

export function ExecutionConsole({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const panel = useResizable({
    initial: DEFAULT_HEIGHT,
    min: MIN_HEIGHT,
    max: maxHeight,
    storageKey: 'yu:console-height',
    edge: 'top',
  });

  // Reported to assistive tech, and kept in step with the window. Held in state
  // rather than read during render: the server has no window, and a value that
  // differs between the two renders is a hydration mismatch.
  const [ceiling, setCeiling] = useState(DEFAULT_HEIGHT * 3);
  useEffect(() => {
    const update = () => setCeiling(maxHeight());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const done = run.steps.filter((s) => s.status === 'SUCCEEDED').length;
  const current = run.steps.find((s) => s.status === 'RUNNING');

  // Follow the tail, but stop the moment the reader scrolls up to look at
  // something — yanking them back is the fastest way to make a log useless.
  useEffect(() => {
    if (stuck && body.current) {
      body.current.scrollTop = body.current.scrollHeight;
    }
  }, [run.logs, stuck]);

  return (
    <section
      style={{ height: open ? panel.size : COLLAPSED_HEIGHT }}
      className={cn(
        'relative flex shrink-0 flex-col border-t border-white/6 bg-sunk',
        // Collapsing is a state change worth animating; dragging is direct
        // manipulation, and any easing there reads as lag.
        !panel.dragging && 'transition-[height] duration-250 ease-[var(--ease-house)]',
      )}
      aria-label="Execution console"
    >
      {open ? (
        <ResizeHandle
          edge="top"
          value={panel.size}
          min={MIN_HEIGHT}
          max={ceiling}
          dragging={panel.dragging}
          label="Resize the execution console"
          onPointerDown={panel.onPointerDown}
          onKeyDown={panel.onKeyDown}
          onReset={panel.reset}
        />
      ) : null}

      <header className="flex h-[38px] shrink-0 items-center gap-3 border-b border-white/6 px-3.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="grid size-5 place-items-center rounded text-faint hover:text-ink"
          aria-label={open ? 'Collapse console' : 'Expand console'}
        >
          <ChevronDown size={13} className={cn('transition-transform', !open && 'rotate-180')} />
        </button>
        <h2 className="text-[11.5px] font-semibold">Execution console</h2>

        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          Step
          {current ? (
            <b className="flex items-center gap-1.5 font-medium text-accent-hi">
              <span className="size-[5px] animate-status rounded-full bg-current" />
              {current.step}
            </b>
          ) : (
            <b className="font-medium text-dim">—</b>
          )}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <span className="num text-[11px] text-faint">
            {done} / {STEPS.length}
          </span>
          <Progress value={done / STEPS.length} className="w-32" />
          <Button size="sm" variant="ghost" onClick={() => setStuck((v) => !v)}>
            {stuck ? 'Following' : 'Paused'}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Clear">
            <Eraser size={12} />
          </Button>
        </div>
      </header>

      {open ? (
        <div
          ref={body}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          className="mono min-h-0 flex-1 overflow-y-auto px-3.5 py-2 text-[11.5px] leading-[1.75]"
        >
          {run.logs.map((l, i) => (
            <div key={i} className="flex gap-2.5">
              <time className="shrink-0 text-faint">{formatClock(l.at)}</time>
              <span className={cn('w-12 shrink-0 font-semibold', LEVEL_TONE[l.level])}>{l.level}</span>
              <span className="shrink-0 text-accent-hi">{l.source}</span>
              <span className="text-dim">{l.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
