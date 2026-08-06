import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `162859` → `2m 43s`. Durations are read at a glance, not parsed. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** Steps of "how long ago", coarsest last. */
const AGO: readonly { readonly limit: number; readonly per: number; readonly unit: string }[] = [
  { limit: 60_000, per: 1_000, unit: 'sec' },
  { limit: 3_600_000, per: 60_000, unit: 'min' },
  { limit: 86_400_000, per: 3_600_000, unit: 'hour' },
  { limit: Number.POSITIVE_INFINITY, per: 86_400_000, unit: 'day' },
];

/**
 * How long ago something happened, in words.
 *
 * Coarse on purpose: a sidebar entry answers "is this recent" and nothing
 * finer. Seconds of precision on a two-day-old run is noise dressed as detail.
 */
export function formatAgo(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);

  if (Number.isNaN(elapsed)) return '—';
  if (elapsed < 45_000) return 'just now';

  const step = AGO.find((entry) => elapsed < entry.limit) ?? AGO[AGO.length - 1];

  if (step === undefined) return '—';

  const count = Math.round(elapsed / step.per);

  return `${String(count)} ${step.unit}${count === 1 ? '' : 's'} ago`;
}
