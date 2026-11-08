/**
 * useSubprojectsList — the two reads behind `/admin/coord/subprojects`:
 *
 * - **the counts** — one `limit=1` read per view (the five headline tabs, All,
 *   and `unknown` for the strip), each answering coord's `total` for its
 *   filter. They feed the tabs' counts, the health strip and the unattached
 *   line, so all three say the same numbers (R1: the strip derives from what
 *   the page shows; it fetches nothing of its own).
 * - **the rows** — the active view's first page, then "Load more" through
 *   coord's cursor. Stored STAMPED with the tab that produced them, and the
 *   rows on screen are derived from whether that stamp matches the tab now
 *   selected: a read for the previous tab can never render under this one,
 *   and a read that failed under a new tab is unknown, not the old tab's
 *   rows called stale (style guide R6, "a filter set is a list route's
 *   param").
 *
 * Why counts are read per view instead of counted from the rows: about 150
 * subprojects are founded a week (one per root session, plan Phase 0), so a
 * page of rows is a window, and a strip counted from a window would say
 * "nothing stalled" about the subprojects beyond it.
 *
 * Polled every 60 s while the tab is visible, single-flight
 * (`useVisiblePoll`); coord serves the list from its reconciler tick's cache,
 * so reading faster than that tick would show nothing new. A poll re-reads the
 * first page only while no further page is loaded, so "Load more" is never
 * undone under the operator.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  fetchSubprojects,
  type SubprojectListResponse,
  type SubprojectSummary,
} from "@/lib/api/operations/coordSubprojects";
import {
  NO_COUNTS,
  SUBPROJECT_TABS,
  classifySubprojectReadFailure,
  viewQuery,
  type SubprojectCounts,
  type SubprojectReadFailure,
  type SubprojectTab,
} from "@/components/admin/coord/subprojects/subprojectStatus";

export const SUBPROJECTS_POLL_MS = 60_000;
export const SUBPROJECTS_PAGE_SIZE = 100;

/** Every view a count is read for. */
const COUNT_VIEWS: ReadonlyArray<SubprojectTab | "unknown"> = [
  ...SUBPROJECT_TABS,
  "unknown",
];

interface CountsValue {
  counts: SubprojectCounts;
  unattached: number | null;
  unattachedByClass: Record<string, number> | null;
  asOf: string | null;
}

interface RowsValue {
  tab: SubprojectTab;
  items: SubprojectSummary[];
  nextCursor: string | null;
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
  /** The latest rows read failed with this, when it did. */
  failure: SubprojectReadFailure | null;
  nextCursor: string | null;
  truncated: boolean;
  asOf: string | null;
}

export interface SubprojectsList {
  counts: SubprojectCounts;
  unattached: number | null;
  unattachedByClass: Record<string, number> | null;
  /** Has any count read ever answered? */
  countsLoaded: boolean;
  /** Every count read of the latest poll failed, with this. */
  countsFailure: SubprojectReadFailure | null;
  countsAsOf: string | null;
  rows: SubprojectsRows;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  loadMoreFailure: SubprojectReadFailure | null;
  refresh: () => Promise<void>;
}

function countsOf(
  answers: PromiseSettledResult<SubprojectListResponse>[]
): CountsValue | null {
  if (answers.every((a) => a.status === "rejected")) return null;
  const counts: SubprojectCounts = { ...NO_COUNTS };
  let unattached: number | null = null;
  let unattachedByClass: Record<string, number> | null = null;
  let asOf: string | null = null;
  COUNT_VIEWS.forEach((view, i) => {
    const a = answers[i];
    if (a === undefined || a.status !== "fulfilled") return;
    counts[view] = typeof a.value.total === "number" ? a.value.total : null;
    if (view === "all") {
      const u = a.value.unattached_units;
      unattached = typeof u?.count === "number" ? u.count : null;
      unattachedByClass = u?.by_class ?? null;
    }
    if (typeof a.value.generated_at === "string" && asOf === null)
      asOf = a.value.generated_at;
  });
  return { counts, unattached, unattachedByClass, asOf };
}

export function useSubprojectsList(tab: SubprojectTab): SubprojectsList {
  const countsAxis = useRetainedValue<CountsValue | null>(null);
  const rowsAxis = useRetainedValue<RowsValue | null>(null);
  const [countsFailure, setCountsFailure] =
    useState<SubprojectReadFailure | null>(null);
  const [rowsFailure, setRowsFailure] = useState<{
    tab: SubprojectTab;
    failure: SubprojectReadFailure;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailure, setLoadMoreFailure] =
    useState<SubprojectReadFailure | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Read by ref, so the poll is not rebuilt on every tab click.
  const tabRef = useRef(tab);
  const rowsRef = useRef<RowsValue | null>(null);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    rowsRef.current = rowsAxis.value;
  }, [rowsAxis.value]);

  const { issue: issueCounts, settle: settleCounts } = countsAxis;
  const { issue: issueRows, settle: settleRows } = rowsAxis;

  const readCounts = useCallback(async () => {
    const seq = issueCounts();
    const answers = await Promise.allSettled(
      COUNT_VIEWS.map((view) =>
        fetchSubprojects(viewQuery(view, 1), COORD_DASHBOARD_POLL_OPTIONS)
      )
    );
    if (cancelled.current) return;
    const value = countsOf(answers);
    settleCounts(seq, value ? { value } : null);
    const first = answers.find((a) => a.status === "rejected");
    setCountsFailure(
      value === null && first && first.status === "rejected"
        ? classifySubprojectReadFailure(first.reason)
        : null
    );
  }, [issueCounts, settleCounts]);

  const readRows = useCallback(
    async (forTab: SubprojectTab) => {
      const seq = issueRows();
      try {
        const page = await fetchSubprojects(
          viewQuery(forTab, SUBPROJECTS_PAGE_SIZE),
          COORD_DASHBOARD_POLL_OPTIONS
        );
        if (cancelled.current) return;
        const applied = settleRows(seq, {
          value: {
            tab: forTab,
            items: Array.isArray(page.items) ? page.items : [],
            nextCursor: page.next_cursor ?? null,
            truncated: page.truncated === true,
            pages: 1,
            asOf:
              typeof page.generated_at === "string" ? page.generated_at : null,
          },
        });
        if (applied) {
          setRowsFailure(null);
          setLoadMoreFailure(null);
        }
      } catch (err) {
        if (cancelled.current) return;
        settleRows(seq, null);
        setRowsFailure({
          tab: forTab,
          failure: classifySubprojectReadFailure(err),
        });
      }
    },
    [issueRows, settleRows]
  );

  const poll = useCallback(async () => {
    const current = rowsRef.current;
    const keepPages =
      current !== null && current.tab === tabRef.current && current.pages > 1;
    await Promise.all([
      readCounts(),
      keepPages ? Promise.resolve() : readRows(tabRef.current),
    ]);
  }, [readCounts, readRows]);

  useVisiblePoll(poll, SUBPROJECTS_POLL_MS, { runOnMount: true });

  // A tab change reads that tab's rows at once; its counts are already read.
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
    if (
      current === null ||
      current.tab !== tabRef.current ||
      !current.nextCursor
    )
      return;
    setLoadingMore(true);
    setLoadMoreFailure(null);
    const seq = issueRows();
    try {
      const page = await fetchSubprojects(
        viewQuery(current.tab, SUBPROJECTS_PAGE_SIZE, current.nextCursor),
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (cancelled.current) return;
      const seen = new Set(current.items.map((s) => s.id));
      settleRows(seq, {
        value: {
          ...current,
          items: [
            ...current.items,
            ...(Array.isArray(page.items) ? page.items : []).filter(
              (s) => !seen.has(s.id)
            ),
          ],
          nextCursor: page.next_cursor ?? null,
          truncated: page.truncated === true,
          pages: current.pages + 1,
        },
      });
    } catch (err) {
      if (cancelled.current) return;
      // A failed page leaves the rows above it as they were: it is not a
      // failure of the list, so it does not stale it (R6 "two states, two
      // sentences").
      settleRows(seq, { value: current });
      setLoadMoreFailure(classifySubprojectReadFailure(err));
    } finally {
      if (!cancelled.current) setLoadingMore(false);
    }
  }, [issueRows, settleRows]);

  const rowsValue = rowsAxis.value;
  const sameTab = rowsValue !== null && rowsValue.tab === tab;
  const failureHere =
    rowsFailure !== null && rowsFailure.tab === tab
      ? rowsFailure.failure
      : null;
  const rows: SubprojectsRows = {
    items: sameTab ? rowsValue.items : [],
    loaded: sameTab,
    stale: sameTab && failureHere !== null,
    failure: failureHere,
    nextCursor: sameTab ? rowsValue.nextCursor : null,
    truncated: sameTab ? rowsValue.truncated : false,
    asOf: sameTab ? rowsValue.asOf : null,
  };

  const countsValue = countsAxis.value;
  return {
    counts: countsValue?.counts ?? NO_COUNTS,
    unattached: countsValue?.unattached ?? null,
    unattachedByClass: countsValue?.unattachedByClass ?? null,
    countsLoaded: countsAxis.hasRead,
    countsFailure,
    countsAsOf: countsValue?.asOf ?? null,
    rows,
    loadMore,
    loadingMore,
    loadMoreFailure,
    refresh,
  };
}
