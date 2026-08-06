'use client';

import Link from 'next/link';

import {
  EmptyRow,
  Pagination,
  SortableTh,
  TableSearch,
  Th,
} from '@/components/ui/table-parts';
import { useTable } from '@/lib/use-table';
import { cn } from '@/lib/utils';

export interface LogRow {
  at: string;
  level: string;
  source: string;
  message: string;
  correlationId: string | null;
  step: string | null;
}

type Column = 'at' | 'level' | 'source' | 'step' | 'message';

const LEVEL_TONE: Record<string, string> = {
  ERROR: 'text-err bg-err/12',
  WARN: 'text-warn bg-warn/12',
  INFO: 'text-node-media bg-node-media/12',
  DEBUG: 'text-faint bg-white/6',
};

/** Severity first when sorting by level — alphabetical would put DEBUG on top. */
const LEVEL_RANK: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

export function LogsTable({ logs }: { logs: LogRow[] }) {
  const table = useTable<LogRow, Column>({
    rows: logs,
    searchable: (line) => [line.message, line.source, line.step, line.level, line.correlationId],
    sortValue: (line, key) => {
      if (key === 'at') return Date.parse(line.at);
      if (key === 'level') return LEVEL_RANK[line.level] ?? 9;
      if (key === 'step') return line.step ?? '';
      if (key === 'source') return line.source.toLowerCase();
      return line.message.toLowerCase();
    },
    initialSort: { key: 'at', direction: 'desc' },
    initialPageSize: 50,
  });

  const counts = LEVELS.map((level) => ({
    level,
    count: logs.filter((line) => line.level === level).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={table.query}
          onChange={table.setQuery}
          placeholder="Search message, source or step"
        />

        {/* Clicking a level searches for it — one control instead of two. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {counts.map((entry) => (
            <button
              key={entry.level}
              type="button"
              onClick={() => table.setQuery(table.query === entry.level ? '' : entry.level)}
              aria-pressed={table.query === entry.level}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-opacity',
                LEVEL_TONE[entry.level],
                table.query === entry.level ? 'ring-1 ring-white/25' : 'opacity-70 hover:opacity-100',
              )}
            >
              {entry.level} <span className="num opacity-80">{entry.count}</span>
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
                <SortableTh label="Time" columnKey="at" sort={table.sort} onSort={table.toggleSort} className="w-28 pl-4" />
                <SortableTh label="Level" columnKey="level" sort={table.sort} onSort={table.toggleSort} className="w-24" />
                <SortableTh label="Source" columnKey="source" sort={table.sort} onSort={table.toggleSort} className="w-44" />
                <SortableTh label="Step" columnKey="step" sort={table.sort} onSort={table.toggleSort} className="w-32" />
                <SortableTh label="Message" columnKey="message" sort={table.sort} onSort={table.toggleSort} />
                <Th className="w-24">Run</Th>
              </tr>
              <tr>
                <td colSpan={6} className="h-px bg-white/8 p-0" />
              </tr>
            </thead>

            <tbody className="mono">
              {table.page.length === 0 ? <EmptyRow colSpan={6} query={table.query} /> : null}
              {table.page.map((line, index) => (
                <tr
                  key={`${line.at}-${String(index)}`}
                  className="border-b border-white/4 align-top transition-colors last:border-b-0 hover:bg-rise/70"
                >
                  <td className="num py-2 pl-4 pr-4 text-[11px] text-faint whitespace-nowrap">
                    {new Date(line.at).toLocaleTimeString()}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        LEVEL_TONE[line.level] ?? 'text-dim bg-white/6',
                      )}
                    >
                      {line.level}
                    </span>
                  </td>
                  <td className="truncate py-2 pr-4 text-[11px] text-accent-hi">{line.source}</td>
                  <td className="truncate py-2 pr-4 text-[11px] text-faint">{line.step ?? '—'}</td>
                  <td className="py-2 pr-4 text-[11.5px] leading-relaxed text-dim">{line.message}</td>
                  <td className="py-2 pr-4 text-[10.5px]">
                    {line.correlationId ? (
                      <Link
                        href={`/workflows?q=${line.correlationId}`}
                        className="text-faint hover:text-accent-hi"
                        title={line.correlationId}
                      >
                        {line.correlationId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
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
    </div>
  );
}
