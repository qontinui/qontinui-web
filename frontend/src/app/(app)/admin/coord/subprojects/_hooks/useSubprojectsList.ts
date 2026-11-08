/**
 * useSubprojectsList — the reads behind `/admin/coord/subprojects`.
 *
 * **The counts.** Coord's list body carries a `counts` facet — every
 * headline's count and the folded counts, in one grouped query over the
 * read's status filter. Two `limit=1` reads take them: `status=open` for the
 * not-done views (and Open, their sum) and `status=all` for Done and All — the
 * filters those views' rows are read under. When a facet is absent (a coord
 * that predates it) or `null` (coord could not take it), that scope falls
 * back to one `limit=1` read per view, whose `total` is the count. Every
 * view's count is a {@link CountReading}: a number, not taken, failed, or the
 * last good number with the latest read's failure beside it. The tabs, the
 * health strip and the unattached line all read these, so they say the same
 * numbers (R1: the strip derives from what the page shows and fetches nothing
 * of its own). Counts are re-read every two minutes; rows every minute.
 *
 * Why counts are read rather than counted from the rows: about 151 root
 * harness ids are founded a week (the plan's Phase 0 result), one subproject
 * each, so a page of rows is a window, and a strip counted from a window would
 * say "nothing stalled" about every stall past it.
 *
 * **The rows.** The active tab's first page, then Load more through coord's
 * cursors. Open is the union of the five not-done headlines (coord filters
 * one headline at a time), merged most-recently-active first. Rows are stored
 * STAMPED with the tab that produced them and derived from whether the stamp
 * matches the tab selected now, so a read for the previous tab never renders
 * under this one, and a read that failed under a new tab is unknown — not the
 * old tab's rows called stale (style guide R6, "a filter set is a list route's
 * param"). Read failures are stamped too (`useStampedFailure`), so an older
 * success can never clear a newer failure. A poll re-reads the first page
 * only while no further page is loaded, so Load more is never undone under
 * the operator; the page says the row refresh is paused then.
 *
 * Polled single-flight while the tab is visible (`useVisiblePoll`); coord
 * serves the list from its reconciler tick's cache, so reading faster than
 * that tick would show nothing new.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  fetchSubprojects,
  type SubprojectListResponse,
  type SubprojectSummary,
} from "@/lib/api/operations/coordSubprojects";
import {
  FACET_VIEWS,
  NO_COUNTS,
  OPEN_HEADLINES,
  UNREAD_COUNT,
  answeredCount,
  classifySubprojectReadFailure,
  countsFromFacet,
  facetQuery,
  failedCount,
  mergeStreamRows,
  openFromParts,
  readCountsFacet,
  viewQuery,
  viewStreams,
  type CountReading,
  type CountView,
  type FacetScope,
  type StreamView,
  type SubprojectCounts,
  type SubprojectReadFailure,
  type SubprojectTab,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import { useStampedFailure } from "@/components/admin/coord/subprojects/useStampedFailure";

export const SUBPROJECTS_ROWS_POLL_MS = 60_000;
export const SUBPROJECTS_COUNTS_POLL_MS = 120_000;
export const SUBPROJECTS_PAGE_SIZE = 100;

interface RowsValue {
  tab: SubprojectTab;
  perStream: Partial<Record<StreamView, SubprojectSummary[]>>;
  cursors: Partial<Record<StreamView, string | null>>;
  truncated: boolean;
  /** How many pages are loaded; a poll refreshes only a single page. */
  pages: number;
  asOf: string | null;
}

export interface SubprojectsRows {
  /** The active tab's rows, or `[]` when none are known for it. */
  items: SubprojectSummary[];
  /** A read for THIS tab has answered. */
  loaded: boolean;
  /** This tab's rows were read, and the latest read of them failed. */
  stale: boolean;
  /** The latest rows read for this tab failed with this, when it did. */
  failure: SubprojectReadFailure | null;
  /** coord holds more rows for this view than are loaded. */
  more: boolean;
  truncated: boolean;
  /** How many pages are loaded (more than one pauses the row refresh). */
  pages: number;
  asOf: string | null;
}

export interface SubprojectsList {
  counts: SubprojectCounts;
  unattached: CountReading;
  unattachedByClass: Record<string, number> | null;
  rows: SubprojectsRows;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  loadMoreFailure: SubprojectReadFailure | null;
  refresh: () => Promise<void>;
}

function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function totalOf(body: SubprojectListResponse): number | null {
  return typeof body.total === "number" ? body.total : null;
}

export function useSubprojectsList(tab: SubprojectTab): SubprojectsList {
  // ─── counts ───
  const [counts, setCounts] = useState<SubprojectCounts>(NO_COUNTS);
  const [openFromHeadlines, setOpenFromHeadlines] = useState(false);
  const [unattached, setUnattached] = useState<CountReading>(UNREAD_COUNT);
  const [unattachedByClass, setUnattachedByClass] = useState<Record<
    string,
    number
  > | null>(null);
  const countsSeq = useRef(0);
  /** The newest read applied per view: an older reply never overwrites it. */
  const appliedSeq = useRef(new Map<CountView, number>());

  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const applyCount = useCallback(
    (
      seq: number,
      view: CountView,
      next: (prev: CountReading) => CountReading
    ) => {
      if ((appliedSeq.current.get(view) ?? 0) > seq) return;
      appliedSeq.current.set(view, seq);
      setCounts((prev) => ({ ...prev, [view]: next(prev[view]) }));
    },
    []
  );

  /** One view's own `limit=1` read — the fallback when a facet is absent. */
  const readViewCount = useCallback(
    async (seq: number, view: Exclude<CountView, "open">) => {
      try {
        const body = await fetchSubprojects(
          viewQuery(view, 1),
          COORD_DASHBOARD_POLL_OPTIONS
        );
        if (cancelled.current) return;
        applyCount(seq, view, () => answeredCount(totalOf(body)));
      } catch (err) {
        if (cancelled.current) return;
        const failure = classifySubprojectReadFailure(err);
        applyCount(seq, view, (prev) => failedCount(prev, failure));
      }
    },
    [applyCount]
  );

  const readScope = useCallback(
    async (seq: number, scope: FacetScope) => {
      let body: SubprojectListResponse;
      try {
        body = await fetchSubprojects(
          facetQuery(scope),
          COORD_DASHBOARD_POLL_OPTIONS
        );
      } catch (err) {
        if (cancelled.current) return;
        const failure = classifySubprojectReadFailure(err);
        for (const view of FACET_VIEWS[scope])
          applyCount(seq, view, (prev) => failedCount(prev, failure));
        if (scope === "all")
          setUnattached((prev) => failedCount(prev, failure));
        return;
      }
      if (cancelled.current) return;
      const total = totalOf(body);
      if (scope === "all") {
        const u = body.unattached_units;
        setUnattached(
          answeredCount(typeof u?.count === "number" ? u.count : null)
        );
        setUnattachedByClass(u?.by_class ?? null);
      }
      const facet = readCountsFacet(body);
      if (facet) {
        const values = countsFromFacet(scope, facet, total);
        for (const [view, value] of Object.entries(values) as Array<
          [CountView, number | null]
        >)
          applyCount(seq, view, () => answeredCount(value));
        if (scope === "open") setOpenFromHeadlines(false);
        return;
      }
      // No facet: this scope's views are read one by one.
      if (scope === "all") {
        applyCount(seq, "all", () => answeredCount(total));
        await readViewCount(seq, "done");
      } else {
        setOpenFromHeadlines(true);
        await Promise.all(OPEN_HEADLINES.map((h) => readViewCount(seq, h)));
      }
    },
    [applyCount, readViewCount]
  );

  const readCounts = useCallback(async () => {
    countsSeq.current += 1;
    const seq = countsSeq.current;
    await Promise.all([readScope(seq, "open"), readScope(seq, "all")]);
  }, [readScope]);

  useVisiblePoll(readCounts, SUBPROJECTS_COUNTS_POLL_MS, { runOnMount: true });

  // ─── rows ───
  const rowsAxis = useRetainedValue<RowsValue | null>(null);
  const rowsFailure = useStampedFailure<SubprojectTab>();
  const { fail: failRows, succeed: succeedRows } = rowsFailure;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailure, setLoadMoreFailure] =
    useState<SubprojectReadFailure | null>(null);

  // Read by ref, so the poll is not rebuilt on every tab click.
  const tabRef = useRef(tab);
  const rowsRef = useRef<RowsValue | null>(null);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    rowsRef.current = rowsAxis.value;
  }, [rowsAxis.value]);

  const { issue: issueRows, settle: settleRows } = rowsAxis;

  const readRows = useCallback(
    async (forTab: SubprojectTab) => {
      const seq = issueRows();
      const streams = viewStreams(forTab);
      const answers = await Promise.allSettled(
        streams.map((view) =>
          fetchSubprojects(
            viewQuery(view, SUBPROJECTS_PAGE_SIZE),
            COORD_DASHBOARD_POLL_OPTIONS
          )
        )
      );
      if (cancelled.current) return;
      const rejected = answers.find((a) => a.status === "rejected");
      if (rejected && rejected.status === "rejected") {
        // A view missing one of its streams is not this view: the read failed.
        settleRows(seq, null);
        failRows(forTab, seq, classifySubprojectReadFailure(rejected.reason));
        return;
      }
      const value: RowsValue = {
        tab: forTab,
        perStream: {},
        cursors: {},
        truncated: false,
        pages: 1,
        asOf: null,
      };
      answers.forEach((a, i) => {
        const view = streams[i];
        if (view === undefined || a.status !== "fulfilled") return;
        value.perStream[view] = Array.isArray(a.value.items)
          ? a.value.items
          : [];
        value.cursors[view] = a.value.next_cursor ?? null;
        value.truncated ||= a.value.truncated === true;
        value.asOf = latest(
          value.asOf,
          typeof a.value.generated_at === "string" ? a.value.generated_at : null
        );
      });
      settleRows(seq, { value });
      succeedRows(forTab, seq);
      setLoadMoreFailure(null);
    },
    [issueRows, settleRows, failRows, succeedRows]
  );

  const pollRows = useCallback(async () => {
    const current = rowsRef.current;
    const keepPages =
      current !== null && current.tab === tabRef.current && current.pages > 1;
    if (!keepPages) await readRows(tabRef.current);
  }, [readRows]);

  useVisiblePoll(pollRows, SUBPROJECTS_ROWS_POLL_MS, { runOnMount: true });

  // A tab change reads that tab's rows at once; the counts are already read.
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    setLoadMoreFailure(null);
    void readRows(tab);
  }, [tab, readRows]);

  const refresh = useCallback(
    () =>
      Promise.all([readCounts(), readRows(tabRef.current)]).then(
        () => undefined
      ),
    [readCounts, readRows]
  );

  const loadMore = useCallback(async () => {
    const current = rowsRef.current;
    if (current === null || current.tab !== tabRef.current) return;
    const streams = viewStreams(current.tab).filter((v) => current.cursors[v]);
    if (streams.length === 0) return;
    setLoadingMore(true);
    setLoadMoreFailure(null);
    const seq = issueRows();
    const answers = await Promise.allSettled(
      streams.map((view) =>
        fetchSubprojects(
          viewQuery(view, SUBPROJECTS_PAGE_SIZE, current.cursors[view]),
          COORD_DASHBOARD_POLL_OPTIONS
        )
      )
    );
    if (cancelled.current) return;
    const rejected = answers.find((a) => a.status === "rejected");
    if (rejected && rejected.status === "rejected") {
      // A failed page leaves the rows above it as they were: it is not a
      // failure of the list, so it does not stale it (R6 "two states, two
      // sentences").
      settleRows(seq, { value: current });
      setLoadMoreFailure(classifySubprojectReadFailure(rejected.reason));
      setLoadingMore(false);
      return;
    }
    const next: RowsValue = {
      ...current,
      perStream: { ...current.perStream },
      cursors: { ...current.cursors },
      truncated: false,
      pages: current.pages + 1,
    };
    answers.forEach((a, i) => {
      const view = streams[i];
      if (view === undefined || a.status !== "fulfilled") return;
      const seen = new Set((next.perStream[view] ?? []).map((s) => s.id));
      next.perStream[view] = [
        ...(next.perStream[view] ?? []),
        ...(Array.isArray(a.value.items) ? a.value.items : []).filter(
          (s) => !seen.has(s.id)
        ),
      ];
      next.cursors[view] = a.value.next_cursor ?? null;
      next.truncated ||= a.value.truncated === true;
    });
    settleRows(seq, { value: next });
    setLoadingMore(false);
  }, [issueRows, settleRows]);

  const rowsValue = rowsAxis.value;
  const sameTab = rowsValue !== null && rowsValue.tab === tab;
  const failureHere = rowsFailure.failureFor(tab);
  const items = useMemo(
    () =>
      sameTab && rowsValue
        ? mergeStreamRows(
            viewStreams(tab).map((v) => rowsValue.perStream[v] ?? [])
          )
        : [],
    [sameTab, rowsValue, tab]
  );
  const rows: SubprojectsRows = {
    items,
    loaded: sameTab,
    stale: sameTab && failureHere !== null,
    failure: failureHere,
    more:
      sameTab && rowsValue !== null
        ? viewStreams(tab).some((v) => Boolean(rowsValue.cursors[v]))
        : false,
    truncated: sameTab && rowsValue !== null ? rowsValue.truncated : false,
    pages: sameTab && rowsValue !== null ? rowsValue.pages : 0,
    asOf: sameTab && rowsValue !== null ? rowsValue.asOf : null,
  };

  const shownCounts = useMemo<SubprojectCounts>(
    () =>
      openFromHeadlines
        ? {
            ...counts,
            open: openFromParts(OPEN_HEADLINES.map((h) => counts[h])),
          }
        : counts,
    [counts, openFromHeadlines]
  );

  return {
    counts: shownCounts,
    unattached,
    unattachedByClass,
    rows,
    loadMore,
    loadingMore,
    loadMoreFailure,
    refresh,
  };
}
