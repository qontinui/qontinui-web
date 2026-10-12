"use client";

/**
 * Keyset paging over a bounded read — the client half of plan
 * `2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus` Phase 4.
 *
 * The plan-library routes (`/plan-library`, `/candidates`, `/followups`,
 * `/reconciliation`) no longer take an `offset`. Each page carries the shared
 * `BoundedReadMeta` keys and an opaque `next_cursor`; the next request passes
 * it back verbatim as `cursor`. There is no way to jump to page N — a cursor
 * is a POSITION in one ordered sequence, not an index — so this keeps the
 * stack of cursors already walked, which is what makes "Previous" possible.
 *
 * `start` is how many rows precede the current page, counted from what the
 * walk actually served (never `pageIndex * limit`, which would lie the moment
 * one page came back short). The server's `total` counts from the page's OWN
 * start, so the whole filtered population is `start + total`.
 */

import { useCallback, useState } from "react";

/** The shared bounded-read keys, as every paged plan-library route serves them. */
export interface BoundedReadMeta {
  count: number;
  limit: number;
  shown: number;
  /** Exact count from THIS page's start; `null` unless `bound_kind` is `exact`. */
  total: number | null;
  /** `null` = unknown, never "no". */
  truncated: boolean | null;
  bound_kind: "exact" | "at_least" | "complete" | "unknown";
  next_cursor: string | null;
  available: boolean;
  filter_narrowed: {
    parameter: string;
    applied: number;
    cap: number;
  } | null;
  enumerate_via: string | null;
}

export interface CursorPosition {
  /** `null` on the first page. */
  cursor: string | null;
  /** Rows served before this page. */
  start: number;
}

const FIRST: CursorPosition = { cursor: null, start: 0 };

export interface CursorPager {
  /** The cursor to send for the current page; `null` = first page. */
  cursor: string | null;
  start: number;
  /** 0 on the first page. */
  pageIndex: number;
  canPrev: boolean;
  /** Advance past a page that served `shown` rows and minted `nextCursor`. */
  next: (nextCursor: string, shown: number) => void;
  prev: () => void;
  /** Back to the first page — every filter change is a new sequence. */
  reset: () => void;
}

export function useCursorPager(): CursorPager {
  const [stack, setStack] = useState<CursorPosition[]>([FIRST]);
  const current = stack[stack.length - 1] ?? FIRST;
  const next = useCallback((nextCursor: string, shown: number) => {
    setStack((s) => {
      const top = s[s.length - 1] ?? FIRST;
      return [...s, { cursor: nextCursor, start: top.start + shown }];
    });
  }, []);
  const prev = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const reset = useCallback(() => {
    setStack((s) => (s.length === 1 && s[0] === FIRST ? s : [FIRST]));
  }, []);
  return {
    cursor: current.cursor,
    start: current.start,
    pageIndex: stack.length - 1,
    canPrev: stack.length > 1,
    next,
    prev,
    reset,
  };
}

/**
 * What one page says about the population it was cut from.
 *
 * * `populationTotal` — `start + total` when the bound is exact; `null` when
 *   the route served no exact count (an `at_least` / `unknown` bound is not
 *   a number to print).
 * * `hasMore` — only `truncated: true` beside a cursor. `truncated: null` is
 *   UNKNOWN and never renders as "that is everything".
 */
export interface BoundedWindow {
  start: number;
  shown: number;
  populationTotal: number | null;
  boundKind: BoundedReadMeta["bound_kind"] | null;
  truncated: boolean | null;
  nextCursor: string | null;
  hasMore: boolean;
}

export function describeBoundedWindow(
  res: Partial<BoundedReadMeta> & { items?: unknown[] },
  start: number
): BoundedWindow {
  const shown = (res.items ?? []).length;
  const total = typeof res.total === "number" ? res.total : null;
  const truncated = typeof res.truncated === "boolean" ? res.truncated : null;
  const nextCursor =
    typeof res.next_cursor === "string" && res.next_cursor !== ""
      ? res.next_cursor
      : null;
  return {
    start,
    shown,
    populationTotal: total !== null ? start + total : null,
    boundKind: res.bound_kind ?? null,
    truncated,
    nextCursor,
    hasMore: truncated === true && nextCursor !== null,
  };
}
