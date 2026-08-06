'use client';

import type { ResizeEdge } from '@/lib/use-resizable';
import { cn } from '@/lib/utils';

/**
 * The draggable edge of a panel.
 *
 * The hit area is 9px thick while the line it paints is 1px — a 1px target is
 * unhittable, and widening the paint to match would put a visible bar between
 * the panels. It is a real focusable separator, so the size can be set from the
 * keyboard as well as by dragging.
 */
export function ResizeHandle({
  edge,
  value,
  min,
  max,
  dragging,
  label,
  onPointerDown,
  onKeyDown,
  onReset,
}: {
  edge: ResizeEdge;
  value: number;
  min: number;
  max: number;
  dragging: boolean;
  label: string;
  onPointerDown: (event: React.PointerEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onReset: () => void;
}) {
  const vertical = edge === 'top' || edge === 'bottom';

  return (
    <div
      role="separator"
      // The separator's own orientation is the line, not the axis it moves on:
      // a handle that resizes height is a horizontal separator.
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
      className={cn(
        'group absolute z-20 focus-visible:outline-none',
        vertical
          ? 'inset-x-0 -top-1 h-[9px] cursor-row-resize'
          : 'inset-y-0 -left-1 w-[9px] cursor-col-resize',
      )}
    >
      {/* The line itself: quiet at rest, accent while it is being used. */}
      <span
        className={cn(
          'pointer-events-none absolute transition-colors duration-150',
          vertical ? 'inset-x-0 top-1 h-px' : 'inset-y-0 left-1 w-px',
          dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/60',
          'group-focus-visible:bg-accent',
        )}
      />
      {/* A grip appears on hover so the edge reads as draggable before it is. */}
      <span
        className={cn(
          'pointer-events-none absolute rounded-full transition-opacity duration-150',
          vertical
            ? 'left-1/2 top-[1.5px] h-[3px] w-9 -translate-x-1/2'
            : 'left-[1.5px] top-1/2 h-9 w-[3px] -translate-y-1/2',
          dragging ? 'bg-accent opacity-100' : 'bg-accent/70 opacity-0 group-hover:opacity-100',
        )}
      />
    </div>
  );
}
