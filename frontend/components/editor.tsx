'use client';

import { PanelRightOpen } from 'lucide-react';
import { useEffect } from 'react';

import { Canvas } from '@/components/canvas/canvas';
import { ExecutionConsole } from '@/components/console';
import { Inspector } from '@/components/inspector/inspector';
import { Sidebar } from '@/components/sidebar';
import { Toasts } from '@/components/toasts';
import { TopBar } from '@/components/top-bar';
import { useRun } from '@/lib/store';

/**
 * The editor shell.
 *
 * Owns the three columns and the console row, and is the only component that
 * knows the run id — everything below it takes data as props, which is what
 * keeps the canvas and the panels independently testable.
 */
export function Editor({ runId }: { runId: string }) {
  const { run, selected, loading, load, watch, unwatch, select, inspectorOpen, setInspectorOpen } =
    useRun();

  useEffect(() => {
    void load(runId);
    watch(runId);

    return unwatch;
  }, [runId, load, watch, unwatch]);

  if (loading || !run) {
    return (
      <main className="grid h-dvh place-items-center bg-void">
        <p className="text-[13px] text-faint">Loading run…</p>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-base text-ink">
      <TopBar run={run} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Canvas run={run} selected={selected} onSelect={select} />
          <ExecutionConsole run={run} />
        </div>
        {inspectorOpen ? (
          <Inspector run={run} selected={selected} />
        ) : (
          // A tab on the edge, so the panel is findable once it is closed.
          // Hiding a surface with no way back is how features get lost.
          <button
            onClick={() => setInspectorOpen(true)}
            aria-label="Open the inspector"
            title="Open the inspector"
            className="group flex w-8 shrink-0 flex-col items-center justify-center gap-2 border-l border-white/6 bg-base text-faint transition-colors hover:bg-rise hover:text-ink"
          >
            <PanelRightOpen size={15} />
            <span className="text-[10px] uppercase tracking-[0.16em] [writing-mode:vertical-rl]">
              Inspector
            </span>
          </button>
        )}
      </div>
      <Toasts />
    </main>
  );
}
