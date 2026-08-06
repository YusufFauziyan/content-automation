'use client';

import { ExternalLink, Loader2, Pencil, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { EmptyRow, Pagination, SortableTh, TableSearch, Th } from '@/components/ui/table-parts';
import { useTable } from '@/lib/use-table';
import { cn } from '@/lib/utils';

export interface UploadRow {
  id: string;
  platform: string;
  title: string;
  status: string;
  externalUrl: string | null;
  externalId: string | null;
  uploadedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  workflowRunId: string | null;
}

type Column = 'createdAt' | 'platform' | 'title' | 'status';

const STATUS_TONE: Record<string, string> = {
  VERIFIED: 'text-ok bg-ok/12',
  UPLOADED: 'text-node-media bg-node-media/12',
  UPLOADING: 'text-node-ai bg-node-ai/12',
  PENDING: 'text-faint bg-white/6',
  FAILED: 'text-err bg-err/12',
};

/**
 * Lifecycle order when sorting, not alphabetical.
 *
 * Sorting by status is asking "how far did these get" — and alphabetically
 * `FAILED` lands between `VERIFIED` and `UPLOADING`, which answers nothing.
 */
const STATUS_RANK: Record<string, number> = {
  FAILED: 0,
  PENDING: 1,
  UPLOADING: 2,
  UPLOADED: 3,
  VERIFIED: 4,
};

const STATUSES = ['VERIFIED', 'UPLOADED', 'UPLOADING', 'PENDING', 'FAILED'] as const;

/** A published URL, shortened to the part that identifies it. */
const shortUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '');

const when = (value: string | null): string =>
  value === null ? '—' : new Date(value).toLocaleString();

/** Statuses a person may set by hand, in the order they mean something. */
const EDITABLE: readonly string[] = ['VERIFIED', 'UPLOADED', 'FAILED'];

/**
 * Everything that has been published, or tried to be.
 *
 * The rendered video is deleted once an upload is verified, so the URL in this
 * table is the only durable trace a run ever produced anything. Failures are
 * listed alongside successes on purpose: a history of successes only would
 * hide the week publishing quietly stopped working.
 */
export function UploadsTable({ uploads }: { uploads: UploadRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<UploadRow | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(row: UploadRow) {
    setRemoving(row.id);
    setError(null);

    const response = await fetch('/api/uploads', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [row.id] }),
    });
    setRemoving(null);

    if (!response.ok) {
      setError('That record could not be removed.');
      return;
    }
    router.refresh();
  }

  const table = useTable<UploadRow, Column>({
    rows: uploads,
    searchable: (row) => [row.title, row.platform, row.status, row.externalUrl, row.externalId],
    sortValue: (row, key) => {
      if (key === 'createdAt') return Date.parse(row.createdAt);
      if (key === 'status') return STATUS_RANK[row.status] ?? 9;
      if (key === 'platform') return row.platform.toLowerCase();
      return row.title.toLowerCase();
    },
    initialSort: { key: 'createdAt', direction: 'desc' },
    initialPageSize: 25,
  });

  const counts = STATUSES.map((status) => ({
    status,
    count: uploads.filter((row) => row.status === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={table.query}
          onChange={table.setQuery}
          placeholder="Search title, platform or URL"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {counts.map((entry) => (
            <button
              key={entry.status}
              type="button"
              onClick={() => table.setQuery(table.query === entry.status ? '' : entry.status)}
              aria-pressed={table.query === entry.status}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-opacity',
                STATUS_TONE[entry.status],
                table.query === entry.status
                  ? 'ring-1 ring-white/25'
                  : 'opacity-70 hover:opacity-100',
              )}
            >
              {entry.status} <span className="num opacity-80">{entry.count}</span>
            </button>
          ))}
        </div>

        {table.query !== '' ? (
          <span className="num text-[11.5px] text-faint">
            {table.matched.length} match{table.matched.length === 1 ? '' : 'es'}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-white/8 bg-rise/30">
        <div className="max-h-[calc(100dvh-280px)] overflow-y-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-base/95 backdrop-blur-sm">
                <SortableTh
                  label="Published"
                  columnKey="createdAt"
                  sort={table.sort}
                  onSort={table.toggleSort}
                  className="w-40 pl-4"
                />
                <SortableTh
                  label="Platform"
                  columnKey="platform"
                  sort={table.sort}
                  onSort={table.toggleSort}
                  className="w-24"
                />
                <SortableTh
                  label="Video"
                  columnKey="title"
                  sort={table.sort}
                  onSort={table.toggleSort}
                />
                <SortableTh
                  label="Status"
                  columnKey="status"
                  sort={table.sort}
                  onSort={table.toggleSort}
                  className="w-28"
                />
                <Th className="w-72">URL</Th>
                <Th className="w-20">Run</Th>
                <Th className="w-20 pr-4 text-right">Edit</Th>
              </tr>
              <tr>
                <td colSpan={7} className="h-px bg-white/8 p-0" />
              </tr>
            </thead>

            <tbody>
              {table.page.length === 0 ? <EmptyRow colSpan={7} query={table.query} /> : null}
              {table.page.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-white/4 align-top transition-colors last:border-b-0 hover:bg-rise/70"
                >
                  <td
                    className="num py-2.5 pl-4 pr-4 text-[11px] whitespace-nowrap text-faint"
                    title={`Verified ${when(row.verifiedAt)}`}
                  >
                    {when(row.uploadedAt ?? row.createdAt)}
                  </td>
                  <td className="py-2.5 pr-4 text-[11.5px] text-dim">{row.platform}</td>
                  <td className="py-2.5 pr-4 text-[12px] text-ink">{row.title}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        STATUS_TONE[row.status] ?? 'bg-white/6 text-dim',
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="mono py-2.5 pr-4 text-[10.5px]">
                    {row.externalUrl === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <a
                        href={row.externalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex max-w-full items-center gap-1 text-faint hover:text-accent-hi"
                        title={row.externalUrl}
                      >
                        <span className="truncate">{shortUrl(row.externalUrl)}</span>
                        <ExternalLink size={10} className="shrink-0" />
                      </a>
                    )}
                  </td>
                  <td className="mono py-2.5 pr-4 text-[10.5px]">
                    {row.workflowRunId === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <Link
                        href={`/workflows/${row.workflowRunId}`}
                        className="text-faint hover:text-accent-hi"
                        title={row.workflowRunId}
                      >
                        {row.workflowRunId.slice(0, 8)}
                      </Link>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit the record for ${row.title}`}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil size={11} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove the record for ${row.title}`}
                        disabled={removing === row.id}
                        onClick={() => void remove(row)}
                      >
                        {removing === row.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Trash2 size={11} />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-[12px] border border-err/25 bg-err/8 px-3.5 py-2.5 text-[12.5px] text-dim">
          {error}
        </p>
      ) : null}

      <Pagination
        range={table.range}
        pageIndex={table.pageIndex}
        pageCount={table.pageCount}
        pageSize={table.pageSize}
        onPageSize={table.setPageSize}
        onGoTo={table.goTo}
      />

      {editing ? <EditDialog row={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/**
 * Correcting one row.
 *
 * Removing the URL is allowed — clearing the box and saving does it — because a
 * URL typed wrong is worse than none: it sends whoever clicks it somewhere that
 * is not the video.
 */
function EditDialog({ row, onClose }: { row: UploadRow; onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState(row.externalUrl ?? '');
  const [status, setStatus] = useState(row.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/uploads/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalUrl: url.trim(), status }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? 'That record could not be changed.');
      return;
    }

    onClose();
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-upload-title"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-6 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[460px] rounded-[16px] border border-white/10 bg-base p-5 shadow-[0_24px_60px_-20px_var(--shadow-modal)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 id="edit-upload-title" className="text-[14.5px] font-semibold tracking-[-0.01em]">
              {row.platform} · {row.title}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              Changes what is recorded here. The video on {row.platform} is untouched either way.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-faint hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <label htmlFor="upload-url" className="mt-5 block text-[11px] font-medium text-dim">
          Published URL
        </label>
        <input
          id="upload-url"
          autoFocus
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.tiktok.com/@handle/video/…"
          className="mono mt-1.5 h-9 w-full rounded-[10px] border border-white/10 bg-rise px-3 text-[12px] text-ink outline-none focus:border-accent"
        />

        <span className="mt-4 block text-[11px] font-medium text-dim">Status</span>
        <div className="mt-1.5 flex gap-1.5">
          {EDITABLE.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity',
                STATUS_TONE[option],
                status === option ? 'ring-1 ring-white/25' : 'opacity-60 hover:opacity-100',
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] border border-err/25 bg-err/8 px-3 py-2 text-[12px] text-err">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
