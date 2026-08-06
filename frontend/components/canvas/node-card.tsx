'use client';

import {
  Captions,
  Film,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Layers,
  List,
  Mic,
  Palette,
  Sparkles,
  Star,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { Badge, STATUS_LABEL, STATUS_TONE } from '@/components/ui/badge';
import { CATEGORY_COLOR, STEP_META, type StepRun } from '@/lib/types';
import { cn, formatDuration } from '@/lib/utils';

export const NODE_W = 268;
export const NODE_H = 112;

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  'file-text': FileText,
  layers: Layers,
  palette: Palette,
  image: ImageIcon,
  list: List,
  mic: Mic,
  captions: Captions,
  'git-branch': GitBranch,
  film: Film,
  star: Star,
  upload: Upload,
  trash: Trash2,
};

/**
 * One step, drawn as a card.
 *
 * Purely presentational — it takes a step run and a selection flag and owns no
 * behaviour of its own, so a new step type needs no change here.
 */
export function NodeCard({
  step,
  x,
  y,
  selected,
  badge,
  onSelect,
}: {
  step: StepRun;
  x: number;
  y: number;
  selected: boolean;
  /** Extra detail shown instead of the duration, e.g. `5/8 stills`. */
  badge?: string;
  onSelect: () => void;
}) {
  const meta = STEP_META[step.step];
  const Icon = ICONS[meta.icon] ?? Sparkles;
  const color = CATEGORY_COLOR[meta.category];
  const running = step.status === 'RUNNING';
  const failed = step.status === 'FAILED';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ left: x, top: y, width: NODE_W, ['--c' as string]: color }}
      className={cn(
        'group absolute rounded-[16px] border bg-base px-3.5 py-3.5 text-left',
        'shadow-[0_2px_6px_var(--shadow-card),0_10px_30px_-14px_var(--shadow-card-deep)]',
        'transition-[transform,box-shadow,border-color] duration-150 ease-[var(--ease-house)]',
        'hover:-translate-y-0.5 hover:shadow-[0_4px_12px_var(--shadow-card),0_24px_60px_-20px_var(--shadow-modal)]',
        running && 'running-ring',
        selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(124,92,255,.35),0_10px_40px_-12px_rgba(124,92,255,.4)]'
          : failed
            ? 'border-err/40'
            : running
              ? 'border-accent/30'
              : 'border-white/10 hover:border-white/16',
      )}
    >
      <span
        className="absolute -left-[5px] top-[26px] size-[10px] rounded-full border-2 bg-base transition-transform duration-150 group-hover:scale-125"
        style={{ borderColor: color }}
      />
      <span
        className="absolute -right-[5px] top-[26px] size-[10px] rounded-full border-2 bg-base transition-transform duration-150 group-hover:scale-125"
        style={{ borderColor: color }}
      />

      {/*
        Title row: what this is on the left, what kind of thing it is on the
        right. The status moves to the footer, where the timing already lives —
        keeping "what it is" and "how it went" from competing on one line.
      */}
      <div className="flex items-start gap-2.5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px]"
          style={{
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent)`,
          }}
        >
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1 pt-px">
          <span className="block truncate text-[13px] font-medium tracking-[-0.008em] text-ink">
            {meta.title}
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] leading-snug text-faint">
            {meta.subtitle}
          </span>
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-white/6 pt-2.5">
        <Badge tone={STATUS_TONE[step.status]} pulse={running}>
          {STATUS_LABEL[step.status]}
        </Badge>
        {failed && step.error ? (
          <span className="mono truncate text-[10px] text-err/90">{step.error.code}</span>
        ) : null}
        <span className="num ml-auto shrink-0 text-[10.5px] text-faint">
          {badge ?? formatDuration(step.durationMs)}
        </span>
      </div>

      {running ? (
        <span className="sr-only" aria-live="polite">
          {meta.title} is running
        </span>
      ) : null}
    </button>
  );
}
