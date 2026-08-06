'use client';

import { create } from 'zustand';

import type { Run, Scene, StepName } from './types';

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  message: string;
  hint?: string;
}

interface State {
  run: Run | null;
  selected: StepName | null;
  loading: boolean;
  polling: boolean;
  /** A resume request is in flight. The button waits on this, not on polling. */
  resuming: boolean;
  toasts: Toast[];

  load: (runId: string) => Promise<void>;
  /** Opens the event stream for a run, and keeps it open. */
  watch: (runId: string) => void;
  /** Closes it. Called when the editor unmounts. */
  unwatch: () => void;
  select: (step: StepName | null) => void;
  resume: (runId: string) => Promise<void>;
  uploadScene: (runId: string, scene: number, file: File) => Promise<void>;
  /** Fills several empty scenes at once. Reports how far it has got. */
  uploadMany: (runId: string, scenes: readonly number[], files: readonly File[]) => Promise<void>;
  /** `null` when no bulk upload is running. */
  bulk: { done: number; total: number } | null;

  /**
   * Whether the inspector is showing.
   *
   * Closed to begin with: the canvas is what someone opens a workflow to look
   * at, and a panel taking a third of the width before anything is selected is
   * a decision made on their behalf. Selecting a node opens it.
   */
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  toast: (tone: Toast['tone'], message: string, hint?: string) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

/**
 * The open event stream, if any.
 *
 * One per run: opening a second would double the work on the server for no
 * extra information. `watch` closes the previous one before opening another.
 */
let source: EventSource | null = null;
let watching: string | null = null;

/** Reconnect backoff after the stream drops, in milliseconds. */
const RETRY_MS = 3_000;

async function readError(res: Response): Promise<{ error: string; hint?: string }> {
  try {
    const body = (await res.json()) as { error?: string; hint?: string };
    return { error: body.error ?? `Request failed (${res.status})`, hint: body.hint };
  } catch {
    return { error: `Request failed (${res.status})` };
  }
}

export const useRun = create<State>((set, get) => ({
  run: null,
  selected: null,
  loading: true,
  polling: false,
  resuming: false,
  bulk: null,
  inspectorOpen: false,
  toasts: [],

  toast(tone, message, hint) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, tone, message, hint }] }));
    setTimeout(() => get().dismiss(id), 6000);
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setInspectorOpen(open) {
    set({ inspectorOpen: open });
  },

  select(step) {
    // Picking a node is a request to look at it, so the panel comes with it.
    // Closing the panel leaves the node selected — the ring on the canvas still
    // says which one you were reading.
    set({ selected: step, inspectorOpen: step !== null });
  },

  /**
   * Fetches the run once.
   *
   * Used for the first paint and after an action that changes state; live
   * updates arrive through {@link watch} instead of by asking again.
   */
  async load(runId) {
    const res = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });

    if (!res.ok) {
      set({ loading: false });
      get().toast('error', 'Could not load this run.');
      return;
    }

    set({ run: (await res.json()) as Run, loading: false });
  },

  watch(runId) {
    if (watching === runId && source !== null) return;

    get().unwatch();
    watching = runId;

    const open = () => {
      const stream = new EventSource(`/api/runs/${runId}/stream`);
      source = stream;

      stream.addEventListener('run', (event) => {
        set({ run: JSON.parse((event as MessageEvent<string>).data) as Run, loading: false, polling: true });
      });

      // The server closes the stream once a run has settled; there is nothing
      // left to report, so this is a normal ending rather than a failure.
      stream.addEventListener('settled', () => {
        stream.close();
        source = null;
        set({ polling: false });
      });

      stream.onerror = () => {
        stream.close();
        source = null;
        set({ polling: false });

        // A dropped connection is worth retrying — a closed one is not, and
        // `watching` is cleared by unwatch when the editor goes away.
        if (watching === runId) {
          setTimeout(() => {
            if (watching === runId && source === null) open();
          }, RETRY_MS);
        }
      };
    };

    open();
  },

  unwatch() {
    watching = null;
    source?.close();
    source = null;
    set({ polling: false });
  },

  async resume(runId) {
    if (get().resuming) return;
    set({ resuming: true });

    try {
      const res = await fetch(`/api/runs/${runId}/resume`, { method: 'POST' });

      if (!res.ok) {
        const { error, hint } = await readError(res);
        get().toast('error', error, hint);
        return;
      }

      get().toast('info', 'Resuming from the step that stopped.');
      await get().load(runId);
    } finally {
      // Cleared whatever happened — a button left spinning after a failure is
      // indistinguishable from one that is still working.
      set({ resuming: false });
    }
  },

  /**
   * Assigns files to empty scenes in order: first file to the lowest-numbered
   * scene without an image, and so on.
   *
   * Sequential rather than parallel. Eight concurrent writes would finish
   * marginally sooner and give no way to say which one failed, and the counter
   * a person watches would jump rather than climb.
   */
  /**
   * Sends everything in one request and lets the server do the matching.
   *
   * A `.zip` cannot be unpacked usefully in the browser, and once one upload
   * has to go to the server whole, doing the same for loose files keeps a
   * single rule for how names map to scenes rather than two that could drift.
   */
  async uploadMany(runId, _scenes, files) {
    if (files.length === 0) return;

    set({ bulk: { done: 0, total: files.length } });

    const body = new FormData();
    for (const file of files) body.append('file', file);

    const res = await fetch(`/api/runs/${runId}/images/bulk`, { method: 'POST', body });
    const result = (await res.json().catch(() => ({}))) as {
      filled?: number;
      remaining?: number;
      rejected?: number;
      leftOver?: number;
      error?: string;
    };

    set({ bulk: null });
    await get().load(runId);

    if (!res.ok) {
      get().toast('error', result.error ?? 'Those files could not be uploaded.');
      return;
    }

    const notes = [
      result.rejected ? `${String(result.rejected)} were not images` : null,
      result.leftOver ? `${String(result.leftOver)} had no empty scene left` : null,
      result.remaining ? `${String(result.remaining)} scene(s) still empty` : null,
    ].filter(Boolean);

    get().toast(
      'ok',
      `Filled ${String(result.filled ?? 0)} scene${result.filled === 1 ? '' : 's'}.`,
      notes.length > 0 ? notes.join(' · ') : undefined,
    );
  },

  async uploadScene(runId, scene, file) {
    set((s) =>
      s.run
        ? {
            run: {
              ...s.run,
              scenes: s.run.scenes.map((x) => (x.scene === scene ? { ...x, status: 'uploading' } : x)),
            },
          }
        : s,
    );

    const body = new FormData();
    body.append('file', file);

    const res = await fetch(`/api/runs/${runId}/scenes/${scene}/image`, { method: 'POST', body });

    if (!res.ok) {
      const { error } = await readError(res);
      get().toast('error', error);
      await get().load(runId);
      return;
    }

    const { scene: updated } = (await res.json()) as { scene: Scene };
    get().toast('ok', `Scene ${scene} now uses your image.`, `${updated.width}×${updated.height}`);
    await get().load(runId);
  },

}));
