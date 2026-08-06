'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  EmptyRow,
  Pagination,
  SortableTh,
  TableSearch,
  Th,
} from '@/components/ui/table-parts';
import type { RunStatus, StepName } from '@/lib/types';
import { useTable } from '@/lib/use-table';
import { cn } from '@/lib/utils';

export interface RunRow {
  id: string;
  title: string;
  status: RunStatus;
  failedStep: StepName | null;
  createdAt: string;
}

const TONE: Record<RunStatus, { label: string; text: string; chip: string; Icon: typeof Clock }> = {
  SUCCEEDED: { label: 'Completed', text: 'text-ok', chip: 'text-ok bg-ok/12', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', text: 'text-err', chip: 'text-err bg-err/12', Icon: AlertTriangle },
  RUNNING: { label: 'Running', text: 'text-accent-hi', chip: 'text-accent-hi bg-accent/15', Icon: Loader2 },
  PENDING: { label: 'Pending', text: 'text-faint', chip: 'text-faint bg-white/6', Icon: Clock },
};

/**
 * The run list, as a table you can act on.
 *
 * Selection lives here rather than in the page because it is view state: which
 * rows are ticked has no meaning once you navigate away, and persisting it
 * would only produce surprises on the next visit.
 */
type Column = 'title' | 'status' | 'failedStep' | 'createdAt';

/** Failed first, then running — the order of who needs attention. */
const STATUS_RANK: Record<RunStatus, number> = { FAILED: 0, RUNNING: 1, PENDING: 2, SUCCEEDED: 3 };

export function RunsTable({ runs, initialQuery = '' }: { runs: RunRow[]; initialQuery?: string }) {
  const router = useRouter();
  const table = useTable<RunRow, Column>({
    rows: runs,
    initialQuery,
    searchable: (run) => [run.title, run.id, run.failedStep, run.status],
    sortValue: (run, key) => {
      if (key === 'status') return STATUS_RANK[run.status];
      if (key === 'createdAt') return Date.parse(run.createdAt);
      if (key === 'failedStep') return run.failedStep ?? '';
      return run.title.toLowerCase();
    },
    initialSort: { key: 'status', direction: 'asc' },
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const lastClicked = useRef<number | null>(null);

  // Select-all covers the page in front of you, not the whole result set —
  // ticking a box must never reach rows you have not seen. Selections made on
  // other pages are kept, and the count in the bar says how many there are.
  const pageIds = table.page.map((run) => run.id);
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  const allSelected = pageIds.length > 0 && pageSelected === pageIds.length;
  const someSelected = pageSelected > 0 && !allSelected;

  const selectedRuns = useMemo(
    () => runs.filter((run) => selected.has(run.id)),
    [runs, selected],
  );

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  /** Shift-click ticks everything between the last click and this one. */
  function toggleRow(index: number, id: string, shiftKey: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      const from = lastClicked.current;

      if (shiftKey && from !== null) {
        const [start, end] = from < index ? [from, index] : [index, from];
        const turningOn = !next.has(id);
        for (let i = start; i <= end; i += 1) {
          const row = table.page[i];
          if (!row) continue;
          if (turningOn) next.add(row.id);
          else next.delete(row.id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      lastClicked.current = index;
      return next;
    });
  }

  async function remove() {
    setBusy(true);
    setNotice(null);

    const response = await fetch('/api/runs', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      deleted?: number;
      skipped?: string[];
      error?: string;
    };

    setBusy(false);
    setConfirming(false);

    if (!response.ok) {
      setNotice({ tone: 'error', text: body.error ?? 'Those runs could not be deleted.' });
      return;
    }

    const skipped = body.skipped?.length ?? 0;
    setNotice({
      tone: 'ok',
      text:
        skipped > 0
          ? `Deleted ${String(body.deleted ?? 0)}. Left ${String(skipped)} alone — still running.`
          : `Deleted ${String(body.deleted ?? 0)} run${body.deleted === 1 ? '' : 's'}.`,
    });

    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p
          role="status"
          className={cn(
            'flex items-center gap-2 rounded-[12px] border px-3.5 py-2.5 text-[12.5px]',
            notice.tone === 'ok' ? 'border-ok/25 bg-ok/8 text-dim' : 'border-err/25 bg-err/8 text-dim',
          )}
        >
          {notice.text}
          <button
            onClick={() => setNotice(null)}
            className="ml-auto text-faint hover:text-ink"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </p>
      ) : null}

      {/* Selection bar. Present only when it has something to say. */}
      {selected.size > 0 ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-accent/25 bg-accent/8 px-3.5 py-2.5">
          <span className="text-[12.5px] text-ink">
            <b className="num font-semibold">{selected.size}</b> selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[12px] text-dim underline-offset-2 hover:text-ink hover:underline"
          >
            Clear
          </button>
          <div className="flex-1" />
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            <Trash2 size={12} /> Delete
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={table.query}
          onChange={table.setQuery}
          placeholder="Search title, id or step"
        />
        {table.query !== '' ? (
          <span className="num text-[11.5px] text-faint">
            {table.matched.length} match{table.matched.length === 1 ? '' : 'es'}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-white/8 bg-rise/30">
        {/* The scroll container is what makes the header sticky — `position:
            sticky` resolves against the nearest scrolling ancestor. */}
        <div className="max-h-[calc(100dvh-260px)] overflow-y-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-base/95 backdrop-blur-sm">
                <Th className="w-10 pl-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label="Select every run on this page"
                    className="size-3.5 cursor-pointer accent-accent"
                  />
                </Th>
                <SortableTh label="Workflow" columnKey="title" sort={table.sort} onSort={table.toggleSort} />
                <SortableTh label="Status" columnKey="status" sort={table.sort} onSort={table.toggleSort} className="w-32" />
                <SortableTh label="Stopped at" columnKey="failedStep" sort={table.sort} onSort={table.toggleSort} className="w-32" />
                <SortableTh label="Created" columnKey="createdAt" sort={table.sort} onSort={table.toggleSort} className="w-44" />
              </tr>
              <tr>
                <td colSpan={5} className="h-px bg-white/8 p-0" />
              </tr>
            </thead>

            <tbody>
              {table.page.length === 0 ? <EmptyRow colSpan={5} query={table.query} /> : null}
              {table.page.map((run, index) => {
                const tone = TONE[run.status];
                const ticked = selected.has(run.id);

                return (
                  <tr
                    key={run.id}
                    data-selected={ticked || undefined}
                    className={cn(
                      'border-b border-white/4 transition-colors last:border-b-0',
                      ticked ? 'bg-accent/8' : 'hover:bg-rise/70',
                    )}
                  >
                    <td className="pl-4">
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={() => undefined}
                        onClick={(event) => toggleRow(index, run.id, event.shiftKey)}
                        aria-label={`Select ${run.title}`}
                        className="size-3.5 cursor-pointer accent-accent"
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <Link href={`/workflows/${run.id}`} className="group block min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink group-hover:text-accent-hi">
                          {run.title}
                        </span>
                        <span className="mono block truncate text-[10.5px] text-faint">{run.id}</span>
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                          tone.chip,
                        )}
                      >
                        <tone.Icon size={11} className={run.status === 'RUNNING' ? 'animate-spin' : ''} />
                        {tone.label}
                      </span>
                    </td>
                    <td className="mono py-3 pr-4 text-[11px] text-faint">{run.failedStep ?? '—'}</td>
                    <td className="num py-3 pr-4 text-[11.5px] text-dim">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        range={table.range}
        pageIndex={table.pageIndex}
        pageCount={table.pageCount}
        pageSize={table.pageSize}
        onPageSize={table.setPageSize}
        onGoTo={table.goTo}
      />

      <p className="text-[11px] text-faint">
        Click a header to sort. Hold <kbd className="mono">Shift</kbd> while ticking to select a
        range. Selections are kept as you move between pages.
      </p>

      {confirming ? (
        <ConfirmDelete
          runs={selectedRuns}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}

/**
 * Deletion is not undoable, so the dialog names what goes and what stays.
 *
 * "Are you sure?" tells nobody anything. What matters is that the script and the
 * scene plan survive — the run record does not.
 */
function ConfirmDelete({
  runs,
  busy,
  onCancel,
  onConfirm,
}: {
  runs: RunRow[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[420px] rounded-[16px] border border-white/10 bg-base p-5 shadow-[0_24px_60px_-20px_var(--shadow-modal)]"
      >
        <h2 id="confirm-title" className="text-[14.5px] font-semibold tracking-[-0.01em]">
          Delete {runs.length} run{runs.length === 1 ? '' : 's'}?
        </h2>

        <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
          Their step history and log records go with them, and this cannot be undone.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
          The topic, script and scene plan each run produced are kept — those are knowledge, not
          execution. A run that is still going is skipped.
        </p>

        <ul className="mono mt-3 max-h-28 overflow-y-auto rounded-[10px] border border-white/8 bg-sunk p-2.5 text-[10.5px] text-faint">
          {runs.slice(0, 8).map((run) => (
            <li key={run.id} className="truncate">
              {run.title}
            </li>
          ))}
          {runs.length > 8 ? <li className="pt-1 text-dim">and {runs.length - 8} more</li> : null}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {busy ? 'Deleting' : `Delete ${runs.length}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
