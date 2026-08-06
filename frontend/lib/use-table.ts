'use client';

import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<TKey extends string> {
  readonly key: TKey;
  readonly direction: SortDirection;
}

interface Options<TRow, TKey extends string> {
  readonly rows: readonly TRow[];
  /** Fields searched by the query box, in the order a reader would scan them. */
  readonly searchable: (row: TRow) => readonly (string | null | undefined)[];
  /** Comparable value for each sortable column. */
  readonly sortValue: (row: TRow, key: TKey) => string | number;
  readonly initialSort: SortState<TKey>;
  readonly initialPageSize?: number;
  /** Search to start from, e.g. one arriving in the URL. */
  readonly initialQuery?: string;
}

export interface Table<TRow, TKey extends string> {
  /** Rows on the current page, after search and sort. */
  readonly page: readonly TRow[];
  /** Every row that survived the search, across all pages. */
  readonly matched: readonly TRow[];
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly sort: SortState<TKey>;
  readonly toggleSort: (key: TKey) => void;
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly setPageSize: (size: number) => void;
  readonly goTo: (index: number) => void;
  /** 1-based range shown, for "showing 26–50 of 57". */
  readonly range: { readonly from: number; readonly to: number; readonly total: number };
}

export const PAGE_SIZES = [25, 50, 100] as const;

/**
 * Search, sort and pagination over a list already in memory.
 *
 * Done on the client because the list arrives whole: a few hundred runs or log
 * lines is nothing to filter locally, and doing it here keeps every interaction
 * instant and the server free of query parameters it would have to validate.
 * At a scale where the whole list no longer fits in one response, this moves
 * behind the API and the component contract stays the same.
 */
export function useTable<TRow, TKey extends string>({
  rows,
  searchable,
  sortValue,
  initialSort,
  initialPageSize = 25,
  initialQuery = '',
}: Options<TRow, TKey>): Table<TRow, TKey> {
  const [query, setQueryRaw] = useState(initialQuery);
  const [sort, setSort] = useState<SortState<TKey>>(initialSort);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);
  const [pageIndex, setPageIndex] = useState(0);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const found =
      needle === ''
        ? [...rows]
        : rows.filter((row) =>
            searchable(row).some((field) => field?.toLowerCase().includes(needle)),
          );

    const factor = sort.direction === 'asc' ? 1 : -1;

    return found.sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * factor;
      }

      return String(left).localeCompare(String(right)) * factor;
    });
    // `searchable` and `sortValue` are declared inline by callers, so a new
    // identity every render would defeat the memo. The row list and the three
    // controls are what actually change the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort.key, sort.direction]);

  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const start = safeIndex * pageSize;
  const page = matched.slice(start, start + pageSize);

  /** Any change to the filter has to return to page one, or the view looks empty. */
  const setQuery = (value: string) => {
    setQueryRaw(value);
    setPageIndex(0);
  };

  const setPageSize = (size: number) => {
    setPageSizeRaw(size);
    setPageIndex(0);
  };

  const toggleSort = (key: TKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
    setPageIndex(0);
  };

  return {
    page,
    matched,
    query,
    setQuery,
    sort,
    toggleSort,
    pageIndex: safeIndex,
    pageCount,
    pageSize,
    setPageSize,
    goTo: (index) => setPageIndex(Math.max(0, Math.min(index, pageCount - 1))),
    range: {
      from: matched.length === 0 ? 0 : start + 1,
      to: Math.min(start + pageSize, matched.length),
      total: matched.length,
    },
  };
}
