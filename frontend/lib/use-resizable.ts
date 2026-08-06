'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom';

interface Options {
  /** Size used before a stored one is read, and the one double-click returns to. */
  readonly initial: number;
  readonly min: number;
  /**
   * Upper bound. A function is evaluated on every commit, which is how a panel
   * stays sane when the window is smaller than the bound you had in mind.
   */
  readonly max: number | (() => number);
  /** localStorage key. Omit to keep the size for this session only. */
  readonly storageKey?: string;
  /** Which edge the handle sits on — decides the axis and the sign of the drag. */
  readonly edge: ResizeEdge;
}

interface Resizable {
  readonly size: number;
  readonly dragging: boolean;
  readonly onPointerDown: (event: React.PointerEvent) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
  readonly reset: () => void;
}

/** How far one arrow-key press moves the edge; Shift makes it a coarse step. */
const STEP = 16;
const COARSE_STEP = 64;

const isVertical = (edge: ResizeEdge) => edge === 'top' || edge === 'bottom';

/**
 * Size of a panel the user can drag.
 *
 * Works on either axis: a `left`/`right` edge resizes width, a `top`/`bottom`
 * edge resizes height, and the sign is worked out from which edge the handle is
 * on — dragging the top edge of a bottom panel upward makes it taller.
 *
 * The stored size is read after mount rather than during render: reading
 * localStorage while rendering makes the server and the client disagree about
 * the first frame, and the panel visibly jumps.
 */
export function useResizable({ initial, min, max, storageKey, edge }: Options): Resizable {
  const [size, setSize] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ at: number; size: number } | null>(null);

  const clamp = useCallback(
    (value: number) => {
      const ceiling = typeof max === 'function' ? max() : max;
      return Math.min(Math.max(ceiling, min), Math.max(min, value));
    },
    [min, max],
  );

  const commit = useCallback(
    (next: number) => {
      const value = Math.round(clamp(next));
      setSize(value);
      if (storageKey) window.localStorage.setItem(storageKey, String(value));
    },
    [clamp, storageKey],
  );

  useEffect(() => {
    if (!storageKey) return;
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) {
      setSize(Math.round(clamp(stored)));
    }
    // Only on mount: re-clamping on every render would fight an active drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      start.current = { at: isVertical(edge) ? event.clientY : event.clientX, size };
      setDragging(true);
    },
    [size, edge],
  );

  // Bound to the window rather than to the handle so a fast drag that outruns
  // the pointer does not drop the gesture.
  useEffect(() => {
    if (!dragging) return;

    const vertical = isVertical(edge);
    // Dragging a `left` or `top` edge outward means a *negative* delta.
    const sign = edge === 'left' || edge === 'top' ? -1 : 1;

    const move = (event: PointerEvent) => {
      const from = start.current;
      if (!from) return;
      const delta = (vertical ? event.clientY : event.clientX) - from.at;
      commit(from.size + sign * delta);
    };
    const stop = () => {
      start.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    // Without this the drag selects text across the whole app.
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragging, commit, edge]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? COARSE_STEP : STEP;
      const vertical = isVertical(edge);
      const outward = edge === 'left' ? 'ArrowLeft' : edge === 'right' ? 'ArrowRight' : edge === 'top' ? 'ArrowUp' : 'ArrowDown';
      const inward = vertical
        ? outward === 'ArrowUp'
          ? 'ArrowDown'
          : 'ArrowUp'
        : outward === 'ArrowLeft'
          ? 'ArrowRight'
          : 'ArrowLeft';

      if (event.key === outward) {
        event.preventDefault();
        commit(size + step);
      } else if (event.key === inward) {
        event.preventDefault();
        commit(size - step);
      } else if (event.key === 'Home') {
        event.preventDefault();
        commit(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        commit(typeof max === 'function' ? max() : max);
      }
    },
    [commit, size, min, max, edge],
  );

  const reset = useCallback(() => commit(initial), [commit, initial]);

  return { size, dragging, onPointerDown, onKeyDown, reset };
}
