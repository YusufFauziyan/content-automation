'use client';

import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { NodeCard, NODE_H, NODE_W } from '@/components/canvas/node-card';
import { STEPS, type Run, type StepName } from '@/lib/types';

const COL = 316;
const ROW = 228;
const PER_ROW = 4;
const PAD_X = 40;
const PAD_Y = 44;

function position(index: number) {
  return {
    x: PAD_X + (index % PER_ROW) * COL,
    y: PAD_Y + Math.floor(index / PER_ROW) * ROW,
  };
}

const WORLD_W = PAD_X * 2 + (PER_ROW - 1) * COL + NODE_W;
const WORLD_H = PAD_Y * 2 + Math.floor((STEPS.length - 1) / PER_ROW) * ROW + NODE_H;

/**
 * Bezier from one card's output port to the next card's input port.
 *
 * A hop to the start of the next row sweeps out to the right, crosses at the
 * midline and comes back in — the ports stay on the sides they belong on, and
 * the curve reads as a single motion rather than a detour.
 */
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x1 = a.x + NODE_W;
  const y1 = a.y + 31;
  const x2 = b.x;
  const y2 = b.y + 31;

  if (x2 >= x1) {
    const d = Math.max(70, (x2 - x1) * 0.5);
    return `M${x1},${y1}C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`;
  }

  const out = x1 + 160;
  const back = x2 - 160;
  const mid = (y1 + y2) / 2;
  return (
    `M${x1},${y1}C${out},${y1} ${out},${mid} ${(out + back) / 2},${mid}` +
    `C${back},${mid} ${back},${y2} ${x2},${y2}`
  );
}

export function Canvas({
  run,
  selected,
  onSelect,
}: {
  run: Run;
  selected: StepName | null;
  onSelect: (step: StepName) => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 24, y: 12, z: 0.86 });
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const fit = useCallback(() => {
    const el = shell.current;
    if (!el) return;
    const z = Math.min(
      1.3,
      Math.max(0.3, Math.min((el.clientWidth - 64) / WORLD_W, (el.clientHeight - 64) / WORLD_H)),
    );
    setView({ x: (el.clientWidth - WORLD_W * z) / 2, y: (el.clientHeight - WORLD_H * z) / 2, z });
  }, []);

  useEffect(() => {
    fit();
  }, [fit]);

  // Wheel is bound manually: React's synthetic handler is passive, so it cannot
  // preventDefault and the page would scroll while zooming.
  useEffect(() => {
    const el = shell.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const z = Math.min(1.8, Math.max(0.28, v.z * Math.pow(1.0016, -e.deltaY)));
        return { z, x: px - (px - v.x) * (z / v.z), y: py - (py - v.y) * (z / v.z) };
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = shell.current;
    if (!el) return;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setView((v) => {
      const z = Math.min(1.8, Math.max(0.28, v.z * factor));
      return { z, x: px - (px - v.x) * (z / v.z), y: py - (py - v.y) * (z / v.z) };
    });
  };

  const stepAt = (name: StepName) => run.steps.find((s) => s.step === name);
  const readyScenes = run.scenes.filter((s) => s.status === 'ok').length;

  /**
   * The steps this run actually has, laid out in pipeline order.
   *
   * Edges are drawn between consecutive entries of *this* list rather than of
   * `STEPS`, so a step the run does not contain closes the gap instead of
   * leaving a line hanging in space. A pipeline that stops early, or a stage
   * that is not built yet, then reads as a shorter chain — which is what it is.
   */
  const drawn = STEPS.map((name, index) => ({ name, index, step: stepAt(name) })).filter(
    (node): node is { name: StepName; index: number; step: NonNullable<typeof node.step> } =>
      node.step !== undefined,
  );

  return (
    <div
      ref={shell}
      className="relative min-h-0 flex-1 overflow-hidden bg-void"
      style={{ cursor: grabbing ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        setGrabbing(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = pan.current;
        if (!p) return;
        setView((v) => ({ ...v, x: p.vx + (e.clientX - p.x), y: p.vy + (e.clientY - p.y) }));
      }}
      onPointerUp={() => {
        pan.current = null;
        setGrabbing(false);
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, var(--canvas-dot) 1px, transparent 0)`,
          backgroundSize: `${22 * view.z}px ${22 * view.z}px`,
          backgroundPosition: `${view.x % (22 * view.z)}px ${view.y % (22 * view.z)}px`,
        }}
      />

      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})` }}
      >
        <svg
          width={WORLD_W}
          height={WORLD_H}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          {drawn.slice(0, -1).map((from, i) => {
            const to = drawn[i + 1];
            if (!to) return null;

            const live = from.step.status === 'SUCCEEDED' && to.step.status !== 'PENDING';
            return (
              <path
                key={from.name}
                d={edgePath(position(from.index), position(to.index))}
                fill="none"
                strokeLinecap="round"
                stroke={live ? 'color-mix(in oklab, var(--color-accent) 75%, transparent)' : 'var(--canvas-edge)'}
                strokeWidth={live ? 2 : 1.6}
                style={
                  live
                    ? {
                        filter:
                          'drop-shadow(0 0 5px color-mix(in oklab, var(--color-accent) 45%, transparent))',
                      }
                    : undefined
                }
              />
            );
          })}
        </svg>

        <div className="absolute left-0 top-0" style={{ width: WORLD_W, height: WORLD_H }}>
          {drawn.map(({ name, index, step }) => {
            const { x, y } = position(index);
            return (
              <NodeCard
                key={name}
                step={step}
                x={x}
                y={y}
                selected={selected === name}
                badge={
                  name === 'IMAGE' && step.status !== 'SUCCEEDED'
                    ? `${readyScenes}/${run.scenes.length} stills`
                    : undefined
                }
                onSelect={() => onSelect(name)}
              />
            );
          })}
        </div>
      </div>

      {/*
        Zoom sits at the top-left, where the eye lands first on a canvas and
        where it does not fight the console panel along the bottom edge. Fit is
        split off into its own control: it is the one people reach for when
        they are lost, and it should not be buried among the increments.
      */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <button
          onClick={fit}
          aria-label="Fit to view"
          className="grid size-9 place-items-center rounded-[12px] border border-white/10 bg-base/85 text-dim backdrop-blur-xl transition-colors hover:bg-rise hover:text-ink"
        >
          <Maximize2 size={14} />
        </button>

        <div className="flex items-center rounded-[12px] border border-white/10 bg-base/85 p-1 backdrop-blur-xl">
          <button
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="Zoom out"
            className="grid size-7 place-items-center rounded-[9px] text-dim transition-colors hover:bg-rise hover:text-ink"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => setView((v) => ({ ...v, z: 1 }))}
            title="Reset to 100%"
            className="num min-w-12 px-1 text-center text-[12px] text-dim transition-colors hover:text-ink"
          >
            {Math.round(view.z * 100)}%
          </button>
          <button
            onClick={() => zoomBy(1.2)}
            aria-label="Zoom in"
            className="grid size-7 place-items-center rounded-[9px] text-dim transition-colors hover:bg-rise hover:text-ink"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3.5 text-[10.5px] text-faint">
        <span>
          <b className="font-medium text-dim">Drag</b> pan
        </span>
        <span>
          <b className="font-medium text-dim">Scroll</b> zoom
        </span>
        <span>
          <b className="font-medium text-dim">Click</b> inspect
        </span>
      </div>
    </div>
  );
}
