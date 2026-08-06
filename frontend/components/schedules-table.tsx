'use client';

import { AlertTriangle, CalendarClock, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyRow, SortableTh, TableSearch, Th } from '@/components/ui/table-parts';
import { useTable } from '@/lib/use-table';
import { cn } from '@/lib/utils';

export interface ScheduleRow {
  id: string;
  name: string;
  language: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  runsStarted: number;
  lastError: string | null;
}

type Column = 'name' | 'intervalMinutes' | 'nextRunAt' | 'runsStarted';

/** Intervals worth offering. Below fifteen minutes a run overlaps itself. */
const INTERVALS = [
  { minutes: 60, label: 'Every hour' },
  { minutes: 180, label: 'Every 3 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Once a day' },
  { minutes: 10080, label: 'Once a week' },
] as const;

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'es', label: 'Español' },
  { code: 'ja', label: '日本語' },
] as const;

const describeInterval = (minutes: number) =>
  INTERVALS.find((entry) => entry.minutes === minutes)?.label ??
  (minutes < 60 ? `Every ${String(minutes)} min` : `Every ${String(Math.round(minutes / 60))} h`);

/**
 * Standing instructions to make videos, and their history.
 *
 * A schedule holds no topic: each firing asks for a fresh subject, so what it
 * makes is decided at the moment it runs rather than when it is written. The
 * duplicate rule is the same one a person meets when they type a topic — a
 * subject the library already covers is refused, and the schedule tries the
 * next idea.
 */
export function SchedulesTable({ schedules }: { schedules: ScheduleRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const table = useTable<ScheduleRow, Column>({
    rows: schedules,
    searchable: (row) => [row.name, row.language],
    sortValue: (row, key) => {
      if (key === 'intervalMinutes') return row.intervalMinutes;
      if (key === 'nextRunAt') return Date.parse(row.nextRunAt);
      if (key === 'runsStarted') return row.runsStarted;
      return row.name.toLowerCase();
    },
    initialSort: { key: 'nextRunAt', direction: 'asc' },
  });

  async function toggle(row: ScheduleRow) {
    setBusy(row.id);
    setError(null);

    const response = await fetch(`/api/schedules/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !row.enabled }),
    });

    setBusy(null);

    if (!response.ok) {
      setError('That schedule could not be changed.');
      return;
    }
    router.refresh();
  }

  async function remove(row: ScheduleRow) {
    setBusy(row.id);
    setError(null);

    const response = await fetch('/api/schedules', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [row.id] }),
    });

    setBusy(null);

    if (!response.ok) {
      setError('That schedule could not be deleted.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-[12px] border border-err/25 bg-err/8 px-3.5 py-2.5 text-[12.5px] text-dim">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <TableSearch value={table.query} onChange={table.setQuery} placeholder="Search schedules" />
        <div className="flex-1" />
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={14} /> New schedule
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-white/8 bg-rise/30">
        <div className="max-h-[calc(100dvh-280px)] overflow-y-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-base/95 backdrop-blur-sm">
                <SortableTh label="Schedule" columnKey="name" sort={table.sort} onSort={table.toggleSort} className="pl-4" />
                <SortableTh label="Every" columnKey="intervalMinutes" sort={table.sort} onSort={table.toggleSort} className="w-32" />
                <Th className="w-24">Language</Th>
                <SortableTh label="Next" columnKey="nextRunAt" sort={table.sort} onSort={table.toggleSort} className="w-40" />
                <SortableTh label="Started" columnKey="runsStarted" sort={table.sort} onSort={table.toggleSort} className="w-24" />
                <Th className="w-36" />
              </tr>
              <tr>
                <td colSpan={6} className="h-px bg-white/8 p-0" />
              </tr>
            </thead>

            <tbody>
              {table.page.length === 0 ? <EmptyRow colSpan={6} query={table.query} /> : null}
              {table.page.map((row) => (
                <tr key={row.id} className="border-b border-white/4 transition-colors last:border-b-0 hover:bg-rise/60">
                  <td className="py-3 pl-4 pr-4">
                    <button
                      type="button"
                      onClick={() => setEditing(row)}
                      className="block text-left text-[13px] font-medium text-ink hover:text-accent-hi"
                    >
                      {row.name}
                    </button>
                    {row.lastError ? (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-warn">
                        <AlertTriangle size={10} />
                        {row.lastError}
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[10.5px] text-faint">
                        {row.lastRunAt ? `Last fired ${new Date(row.lastRunAt).toLocaleString()}` : 'Not fired yet'}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-[12px] text-dim">{describeInterval(row.intervalMinutes)}</td>
                  <td className="mono py-3 pr-4 text-[11.5px] text-faint">{row.language}</td>
                  <td className="num py-3 pr-4 text-[11.5px] text-dim">
                    {row.enabled ? new Date(row.nextRunAt).toLocaleString() : '—'}
                  </td>
                  <td className="num py-3 pr-4 text-[12px] text-dim">{row.runsStarted}</td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => void toggle(row)}
                        disabled={busy === row.id}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                          row.enabled ? 'bg-ok/12 text-ok hover:bg-ok/20' : 'bg-white/6 text-faint hover:bg-white/10',
                        )}
                      >
                        {busy === row.id ? '…' : row.enabled ? 'Active' : 'Paused'}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${row.name}`}
                        disabled={busy === row.id}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil size={12} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${row.name}`}
                        disabled={busy === row.id}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Each firing asks for a fresh subject and starts a run. A topic the library already covers is
        refused and the next idea is tried, so a schedule never makes the same video twice.
      </p>

      {creating ? <ScheduleDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <ScheduleDialog schedule={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/**
 * Creating and editing are the same form.
 *
 * They ask for the same three things and differ only in where they post and
 * what they start from, so two components would be two places to change every
 * time a field is added.
 */
function ScheduleDialog({
  schedule,
  onClose,
}: {
  schedule?: ScheduleRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = schedule !== undefined;
  const [name, setName] = useState(schedule?.name ?? '');
  const [language, setLanguage] = useState(schedule?.language ?? 'en');
  const [intervalMinutes, setIntervalMinutes] = useState(schedule?.intervalMinutes ?? 360);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(
      editing ? `/api/schedules/${schedule.id}` : '/api/schedules',
      {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), language, intervalMinutes }),
      },
    );

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? `That schedule could not be ${editing ? 'changed' : 'created'}.`);
      return;
    }

    onClose();
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-schedule-title"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-6 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[420px] rounded-[16px] border border-white/10 bg-base p-5 shadow-[0_24px_60px_-20px_var(--shadow-modal)]"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent/15 text-accent-hi">
            <CalendarClock size={15} />
          </span>
          <div className="flex-1">
            <h2 id="new-schedule-title" className="text-[14.5px] font-semibold tracking-[-0.01em]">
              {editing ? 'Edit schedule' : 'New schedule'}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              {editing
                ? 'Changing how often it runs moves the next firing to match.'
                : 'Makes videos on its own. Each one gets a fresh subject the library does not already cover.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-faint hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <label htmlFor="schedule-name" className="mt-5 block text-[11px] font-medium text-dim">
          Name
        </label>
        <input
          id="schedule-name"
          autoFocus
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Daily knowledge shorts"
          className="mt-1.5 h-9 w-full rounded-[10px] border border-white/10 bg-rise px-3 text-[13px] text-ink outline-none focus:border-accent"
        />

        <label htmlFor="schedule-every" className="mt-3 block text-[11px] font-medium text-dim">
          How often
        </label>
        <select
          id="schedule-every"
          value={intervalMinutes}
          onChange={(event) => setIntervalMinutes(Number(event.target.value))}
          className="mt-1.5 h-9 w-full cursor-pointer rounded-[10px] border border-white/10 bg-rise px-3 text-[13px] text-ink outline-none focus:border-accent"
        >
          {INTERVALS.map((entry) => (
            <option key={entry.minutes} value={entry.minutes}>
              {entry.label}
            </option>
          ))}
        </select>

        <label htmlFor="schedule-language" className="mt-3 block text-[11px] font-medium text-dim">
          Language
        </label>
        <select
          id="schedule-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="mt-1.5 h-9 w-full cursor-pointer rounded-[10px] border border-white/10 bg-rise px-3 text-[13px] text-ink outline-none focus:border-accent"
        >
          {LANGUAGES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>

        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] border border-err/25 bg-err/8 px-3 py-2 text-[12px] text-err">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : editing ? (
              <Save size={13} />
            ) : (
              <Plus size={13} />
            )}
            {busy ? 'Saving' : editing ? 'Save changes' : 'Create'}
          </Button>
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
          {editing
            ? 'Measured from the last firing, so shortening an interval brings the next video forward rather than starting one now.'
            : 'Schedules only advance while the backend is serving. The first video arrives one interval from now.'}
        </p>
      </form>
    </div>
  );
}
