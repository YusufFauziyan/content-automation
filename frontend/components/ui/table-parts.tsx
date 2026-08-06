'use client';

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

import { PAGE_SIZES, type SortState } from '@/lib/use-table';
import { cn } from '@/lib/utils';

/** Search box. Filters as you type — there is nothing to submit. */
export function TableSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative flex h-8 w-full max-w-[300px] items-center">
      <Search size={13} className="pointer-events-none absolute left-3 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full rounded-[10px] border border-white/10 bg-rise pl-8 pr-8 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== '' ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear the search"
          className="absolute right-2.5 text-faint hover:text-ink"
        >
          <X size={13} />
        </button>
      ) : null}
    </label>
  );
}

/**
 * A column header you can sort by.
 *
 * The arrow appears only on the sorted column: showing a neutral glyph on every
 * header teaches nothing and adds six pieces of furniture to read past.
 */
export function SortableTh<TKey extends string>({
  label,
  columnKey,
  sort,
  onSort,
  className,
  align = 'left',
}: {
  label: string;
  columnKey: TKey;
  sort: SortState<TKey>;
  onSort: (key: TKey) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = sort.key === columnKey;
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('bg-base/95 p-0', className)}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={cn(
          'flex w-full items-center gap-1.5 py-2.5 pr-4 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors',
          align === 'right' && 'justify-end',
          active ? 'text-dim' : 'text-faint hover:text-dim',
        )}
      >
        {label}
        {active ? <Arrow size={11} className="text-accent-hi" /> : null}
      </button>
    </th>
  );
}

/** Plain header cell, for columns that cannot be ordered meaningfully. */
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'bg-base/95 py-2.5 pr-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint',
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * Page controls.
 *
 * The range is spelled out rather than implied by a page number, because
 * "showing 26–50 of 57" answers the question people actually have.
 */
export function Pagination({
  range,
  pageIndex,
  pageCount,
  pageSize,
  onPageSize,
  onGoTo,
}: {
  range: { from: number; to: number; total: number };
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  onPageSize: (size: number) => void;
  onGoTo: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="num text-[11.5px] text-faint">
        {range.total === 0
          ? 'Nothing to show'
          : `Showing ${range.from}–${range.to} of ${range.total}`}
      </p>

      <div className="flex-1" />

      <label className="flex items-center gap-2 text-[11.5px] text-faint">
        Rows
        <select
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          aria-label="Rows per page"
          className="h-7 cursor-pointer rounded-[8px] border border-white/10 bg-rise px-2 text-[11.5px] text-dim outline-none focus:border-accent"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1">
        <PageButton
          label="Previous page"
          disabled={pageIndex === 0}
          onClick={() => onGoTo(pageIndex - 1)}
        >
          <ChevronLeft size={14} />
        </PageButton>

        <span className="num min-w-[74px] text-center text-[11.5px] text-dim">
          {pageIndex + 1} of {pageCount}
        </span>

        <PageButton
          label="Next page"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onGoTo(pageIndex + 1)}
        >
          <ChevronRight size={14} />
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-7 place-items-center rounded-[8px] border border-white/10 bg-rise text-dim transition-colors hover:bg-lift hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Shown in place of rows when a search matches nothing. */
export function EmptyRow({ colSpan, query }: { colSpan: number; query: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-[12.5px] text-faint">
        {query === '' ? 'Nothing here yet.' : `Nothing matches “${query}”.`}
      </td>
    </tr>
  );
}
