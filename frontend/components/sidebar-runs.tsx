'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { RunSummary } from '@/lib/types';
import { cn, formatAgo } from '@/lib/utils';

/**
 * How many runs the panel carries.
 *
 * Five, because this is a glance and not the list. Anyone who wants the rest is
 * one click away on Workflows, and a sidebar that grows with the backlog stops
 * being scannable at exactly the point it matters most.
 */
const RECENT = 5;

/** The dot colour that says how a run ended, at a glance. */
const TONE: Record<string, string> = {
  SUCCEEDED: 'bg-ok',
  RUNNING: 'bg-accent',
  FAILED: 'bg-err',
  PENDING: 'bg-faint',
};

/**
 * The runs worth glancing at, in every sidebar.
 *
 * Owns its own fetch and its own heading so the two sidebars — the editor's and
 * the one around the read-only pages — cannot end up showing different things.
 * They had already drifted: this panel existed in one and not the other, which
 * is the same failure `lib/navigation.ts` exists to prevent.
 *
 * A run gets a thumbnail rather than another icon row: it is a *thing that
 * happened*, not a place to go, and giving it the same shape as Dashboard or
 * Logs would flatten the difference. The tile carries the state, the line under
 * the title carries the age, and neither needs reading to be understood.
 */
export function RecentRuns({ collapsed = false }: { collapsed?: boolean }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const pathname = usePathname();

  // Refetched on navigation rather than on a timer: a run list in the corner of
  // the screen does not need to be live, and polling it from every page would
  // be a request every few seconds for something nobody is watching.
  useEffect(() => {
    let live = true;

    void fetch('/api/runs')
      .then((response) => (response.ok ? response.json() : { runs: [] }))
      .then((body: { runs?: RunSummary[] }) => {
        if (live) setRuns((body.runs ?? []).slice(0, RECENT));
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [pathname]);

  return (
    <div className="mt-4 border-t border-white/6 pt-3">
      <p
        className={cn(
          'px-2.5 pb-1.5 text-[10.5px] font-medium tracking-[0.04em] text-faint uppercase',
          'transition-opacity',
          collapsed && 'opacity-0',
        )}
      >
        Recent runs
      </p>

      {runs.length === 0 ? (
        <p
          className={cn(
            'px-2.5 py-1 text-[11px] leading-relaxed text-faint',
            collapsed && 'opacity-0',
          )}
        >
          Nothing has run yet.
        </p>
      ) : (
        <div className="flex flex-col gap-px">
          {runs.map((run) => {
            const current = pathname === `/workflows/${run.id}`;

            return (
              <Link
                key={run.id}
                href={`/workflows/${run.id}`}
                aria-current={current ? 'page' : undefined}
                title={run.title}
                className={cn(
                  'flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors',
                  current ? 'bg-rise' : 'hover:bg-rise/70',
                )}
              >
                <span className="relative grid size-8 shrink-0 place-items-center rounded-[8px] border border-white/8 bg-sunk">
                  <span className="h-3 w-4 rounded-[2px] border border-white/12" />
                  <span
                    className={cn(
                      'absolute top-1 right-1 size-1.5 rounded-full',
                      TONE[run.status] ?? 'bg-faint',
                      run.status === 'RUNNING' && 'animate-status',
                    )}
                  />
                </span>
                <span className={cn('min-w-0 flex-1 transition-opacity', collapsed && 'opacity-0')}>
                  <span className="block truncate text-[12.5px] leading-tight text-ink">
                    {run.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                    {formatAgo(run.createdAt)}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <Link
        href="/workflows?new=1"
        className={cn(
          'mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-[10px]',
          'border border-white/10 text-[12.5px] text-dim',
          'transition-colors hover:border-white/16 hover:bg-rise hover:text-ink',
        )}
      >
        <Plus size={14} strokeWidth={2} />
        <span className={cn('whitespace-nowrap', collapsed && 'hidden')}>New workflow</span>
      </Link>
    </div>
  );
}
