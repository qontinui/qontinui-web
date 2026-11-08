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
 * Each count keeps its OWN read sequence (`readSequence.ts`): a reply is
 * applied when it is at least as new as the value on screen, and the count is
 * stale while a newer read finished without replacing it. So a superseded
 * success that lands after a newer failure is still applied — and said to be
 * stale — while a superseded failure that lands after a newer success changes
 * nothing. The unattached count (with its classes) and "is Open summed from
 * its parts" follow the same rule.
 *
 * Why counts are read rather than counted from the rows: about 151 root
 * harness ids are founded a week (the plan's Phase 0 result), one subproject
 * each, so a page of rows is a window, and a strip counted from a window would
 * say "nothing stalled" about every stall past it.
 *
 * **The rows.** The active tab's first page, then Load more through coord's
 * cursor. Open is ONE read (`exclude_headline=done`); a coord that answers
 * 400/422 to that parameter gets the per-headline fallback — the five
 * not-done headlines read one by one and merged most-recently-active first.
 * Rows are stored STAMPED with the tab that produced them and derived from
 * whether the stamp matches the tab selected now, so a read for the previous
 * tab never renders under this one, and a read that failed under a new tab is
 * unknown — not the old tab's rows called stale (style guide R6, "a filter
 * set is a list route's param"). Read failures are stamped too
 * (`useStampedFailure`), so an older success can never clear a newer failure,
 * and so is Load more's state, so its failure is never shown under another
 * tab. A poll re-reads the first page only while no further page is loaded,
 * so Load more is never undone under the operator; the page says the row
 * refresh is paused then.
 *
 * Polled single-flight while the tab is visible (`useVisiblePoll`); coord
 * serves the list from its reconciler tick's cache, so reading faster than
 * that tick would show nothing new.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createReadSequence,
  useRetainedValue,
  type ReadSequence,
} from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  fetchSubprojects,
  type SubprojectListResponse,
  type SubprojectSummary,
  type SubprojectUnattachedUnits,
} from "@/lib/api/operations/coordSubprojects";
import {
  FACET_VIEWS,
  NO_COUNTS,
  OPEN_HEADLINES,
  UNREAD_COUNT,
  classifySubprojectReadFailure,
  countsFromFacet,
  facetQuery,
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
  /** The streams this value was read as — Open's one, or its fallback's
   *  five — so the rows derive from what was read, not from a flag. */
  streams: StreamView[];
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
  /** A Load more for THIS tab is out. */
  loadingMore: boolean;
  /** This tab's latest Load more failed with this. */
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

/** coord refused `exclude_headline` itself: a coord that predates it. */
function refusedTheParameter(err: unknown): boolean {
  const status = httpStatusOf(err);
  return status === 400 || status === 422;
}

/**
 * The rows a stream answered with. Open's one read drops a `done` row: coord
 * excludes them by `exclude_headline=done`, so one in the answer means that
 * coord ignored the parameter — and a done row does not belong in Open either
 * way.
 */
function streamItems(
  view: StreamView,
  body: SubprojectListResponse
): SubprojectSummary[] {
  const items = Array.isArray(body.items) ? body.items : [];
  return view === "open" ? items.filter((s) => s.headline !== "done") : items;
}

// ─── one count's bookkeeping ───

type CountKey = CountView | "unattached";

const COUNT_KEYS: readonly CountKey[] = [
  "open",
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "done",
  "all",
  "unknown",
  "unattached",
];

/** A count's own read sequence, the value its newest delivering read carried,
 *  and the newest failure — enough to say what the count is. */
interface CountSlot {
  seq: ReadSequence;
  value: number | null;
  byClass: Record<string, number> | null;
  failure: { ticket: number; failure: SubprojectReadFailure } | null;
}

function newSlots(): Record<CountKey, CountSlot> {
  const slots = {} as Record<CountKey, CountSlot>;
  for (const key of COUNT_KEYS)
    slots[key] = {
      seq: createReadSequence(),
      value: null,
      byClass: null,
      failure: null,
    };
  return slots;
}

/** What a slot says: its value while current; the newest failure beside a
 *  kept value once a newer read failed to replace it; the failure alone when
 *  nothing ever answered. */
function readingOf(slot: CountSlot): CountReading {
  const answered = slot.seq.hasDelivered();
  const showFailure = !answered || slot.seq.isStale();
  return {
    value: answered ? slot.value : null,
    answered,
    failure: showFailure ? (slot.failure?.failure ?? null) : null,
  };
}

type Tickets = Record<CountKey, number> & { openScope: number };

export function useSubprojectsList(tab: SubprojectTab): SubprojectsList {
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // ─── counts ───
  const slots = useRef<Record<CountKey, CountSlot> | null>(null);
  if (slots.current === null) slots.current = newSlots();
  /** Whether Open's count is summed from its parts (no facet): its own
   *  sequence, settled by the open scope's reads only. */
  const openScopeSeq = useRef<ReadSequence | null>(null);
  if (openScopeSeq.current === null)
    openScopeSeq.current = createReadSequence();

  const [counts, setCounts] = useState<SubprojectCounts>(NO_COUNTS);
  const [unattached, setUnattached] = useState<CountReading>(UNREAD_COUNT);
  const [unattachedByClass, setUnattachedByClass] = useState<Record<
    string,
    number
  > | null>(null);
  const [openFromHeadlines, setOpenFromHeadlines] = useState(false);

  /** Re-render one count from its slot. */
  const publish = useCallback((key: CountKey) => {
    const slot = slots.current![key];
    if (key === "unattached") {
      setUnattached(readingOf(slot));
      setUnattachedByClass(slot.byClass);
      return;
    }
    setCounts((prev) => ({ ...prev, [key]: readingOf(slot) }));
  }, []);

  const deliver = useCallback(
    (
      key: CountKey,
      ticket: number,
      value: number | null,
      byClass: Record<string, number> | null = null
    ) => {
      const slot = slots.current![key];
      if (slot.seq.settle(ticket, true)) {
        slot.value = value;
        slot.byClass = byClass;
      }
      publish(key);
    },
    [publish]
  );

  const failCount = useCallback(
    (key: CountKey, ticket: number, failure: SubprojectReadFailure) => {
      const slot = slots.current![key];
      slot.seq.settle(ticket, false);
      if (slot.failure === null || slot.failure.ticket < ticket)
        slot.failure = { ticket, failure };
      publish(key);
    },
    [publish]
  );

  const deliverUnattached = useCallback(
    (ticket: number, u: SubprojectUnattachedUnits | null | undefined) => {
      deliver(
        "unattached",
        ticket,
        typeof u?.count === "number" ? u.count : null,
        u?.by_class ?? null
      );
    },
    [deliver]
  );

  /** One view's own `limit=1` read — the fallback when a facet is absent. */
  const readViewCount = useCallback(
    async (view: Exclude<CountView, "open">, ticket: number) => {
      try {
        const body = await fetchSubprojects(
          viewQuery(view, 1),
          COORD_DASHBOARD_POLL_OPTIONS
        );
        if (cancelled.current) return;
        deliver(view, ticket, totalOf(body));
      } catch (err) {
        if (cancelled.current) return;
        failCount(view, ticket, classifySubprojectReadFailure(err));
      }
    },
    [deliver, failCount]
  );

  const readScope = useCallback(
    async (scope: FacetScope, tickets: Tickets) => {
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
          failCount(view, tickets[view], failure);
        if (scope === "all")
          failCount("unattached", tickets.unattached, failure);
        else openScopeSeq.current!.settle(tickets.openScope, false);
        return;
      }
      if (cancelled.current) return;
      const total = totalOf(body);
      const facet = readCountsFacet(body);
      if (scope === "all")
        deliverUnattached(tickets.unattached, body.unattached_units);
      else if (openScopeSeq.current!.settle(tickets.openScope, true))
        setOpenFromHeadlines(facet === null);
      if (facet) {
        const values = countsFromFacet(scope, facet, total);
        for (const [view, value] of Object.entries(values) as Array<
          [CountView, number | null]
        >)
          deliver(view, tickets[view], value);
        return;
      }
      // No facet: this scope's views are read one by one.
      if (scope === "all") {
        deliver("all", tickets.all, total);
        await readViewCount("done", tickets.done);
      } else {
        await Promise.all(
          OPEN_HEADLINES.map((h) => readViewCount(h, tickets[h]))
        );
      }
    },
    [deliver, deliverUnattached, failCount, readViewCount]
  );

  const readCounts = useCallback(async () => {
    // A ticket from each count's OWN sequence (`useRetainedValue`'s note: a
    // shared counter would leave each sequence's `issued` at zero).
    const tickets = {} as Tickets;
    for (const key of COUNT_KEYS)
      tickets[key] = slots.current![key].seq.issue();
    tickets.openScope = openScopeSeq.current!.issue();
    await Promise.all([readScope("open", tickets), readScope("all", tickets)]);
  }, [readScope]);

  useVisiblePoll(readCounts, SUBPROJECTS_COUNTS_POLL_MS, { runOnMount: true });

  // ─── rows ───
  const rowsAxis = useRetainedValue<RowsValue | null>(null);
  const rowsFailure = useStampedFailure<SubprojectTab>();
  const { fail: failRows, succeed: succeedRows } = rowsFailure;
  const [loadingMoreTab, setLoadingMoreTab] = useState<SubprojectTab | null>(
    null
  );
  const [loadMoreFailure, setLoadMoreFailure] = useState<{
    tab: SubprojectTab;
    failure: SubprojectReadFailure;
  } | null>(null);
  /** Open is read per headline once coord refused `exclude_headline`. */
  const openPerHeadline = useRef(false);

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
    async (forTab: SubprojectTab): Promise<void> => {
      const seq = issueRows();
      for (;;) {
        const streams = viewStreams(forTab, openPerHeadline.current);
        const answers = await Promise.allSettled(
          streams.map((view) =>
            fetchSubprojects(
              viewQuery(view, SUBPROJECTS_PAGE_SIZE),
              COORD_DASHBOARD_POLL_OPTIONS
            )
          )
        );
        if (cancelled.current) return;
        const [only] = answers;
        if (
          streams.length === 1 &&
          streams[0] === "open" &&
          only?.status === "rejected" &&
          refusedTheParameter(only.reason)
        ) {
          // This coord does not take `exclude_headline`: read Open the way it
          // can be read, under the same ticket. That refusal is not a failure
          // of the view, so it settles nothing.
          openPerHeadline.current = true;
          continue;
        }
        const rejected = answers.find((a) => a.status === "rejected");
        if (rejected && rejected.status === "rejected") {
          // A view missing one of its streams is not this view: the read
          // failed.
          settleRows(seq, null);
          failRows(forTab, seq, classifySubprojectReadFailure(rejected.reason));
          return;
        }
        const value: RowsValue = {
          tab: forTab,
          streams,
          perStream: {},
          cursors: {},
          truncated: false,
          pages: 1,
          asOf: null,
        };
        answers.forEach((a, i) => {
          const view = streams[i];
          if (view === undefined || a.status !== "fulfilled") return;
          value.perStream[view] = streamItems(view, a.value);
          value.cursors[view] = a.value.next_cursor ?? null;
          value.truncated ||= a.value.truncated === true;
          value.asOf = latest(
            value.asOf,
            typeof a.value.generated_at === "string"
              ? a.value.generated_at
              : null
          );
        });
        settleRows(seq, { value });
        succeedRows(forTab, seq);
        // A fresh first page makes an earlier Load more failure moot.
        setLoadMoreFailure((prev) => (prev?.tab === forTab ? null : prev));
        return;
      }
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
    const forTab = current.tab;
    const streams = current.streams.filter((v) => current.cursors[v]);
    if (streams.length === 0) return;
    setLoadingMoreTab(forTab);
    setLoadMoreFailure((prev) => (prev?.tab === forTab ? null : prev));
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
    setLoadingMoreTab((prev) => (prev === forTab ? null : prev));
    const rejected = answers.find((a) => a.status === "rejected");
    if (rejected && rejected.status === "rejected") {
      // A failed page leaves the rows above it as they were: it is not a
      // failure of the list, so it does not stale it (R6 "two states, two
      // sentences") — and it is stamped with its tab, so it is never shown
      // under another one.
      settleRows(seq, { value: current });
      setLoadMoreFailure({
        tab: forTab,
        failure: classifySubprojectReadFailure(rejected.reason),
      });
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
        ...streamItems(view, a.value).filter((s) => !seen.has(s.id)),
      ];
      next.cursors[view] = a.value.next_cursor ?? null;
      next.truncated ||= a.value.truncated === true;
    });
    settleRows(seq, { value: next });
  }, [issueRows, settleRows]);

  const rowsValue = rowsAxis.value;
  const sameTab = rowsValue !== null && rowsValue.tab === tab;
  const failureHere = rowsFailure.failureFor(tab);
  const items = useMemo(
    () =>
      sameTab && rowsValue
        ? mergeStreamRows(
            rowsValue.streams.map((v) => rowsValue.perStream[v] ?? [])
          )
        : [],
    [sameTab, rowsValue]
  );
  const rows: SubprojectsRows = {
    items,
    loaded: sameTab,
    stale: sameTab && failureHere !== null,
    failure: failureHere,
    more:
      sameTab && rowsValue !== null
        ? rowsValue.streams.some((v) => Boolean(rowsValue.cursors[v]))
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
    loadingMore: loadingMoreTab === tab,
    loadMoreFailure:
      loadMoreFailure !== null && loadMoreFailure.tab === tab
        ? loadMoreFailure.failure
        : null,
    refresh,
  };
}
