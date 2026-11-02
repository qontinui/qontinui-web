"use client";

/**
 * The session run-record reads behind `/admin/coord/session-load`, polled —
 * and the run list a drill-down reads, page by page.
 *
 * Transport: the web backend's passthrough proxies (`/api/v1/operations/
 * session-runs…`, through `@/lib/api/operations/coordSessionRuns`). **Never
 * call coord from the browser.**
 *
 * One poll asks four questions, in parallel:
 *
 * 1. **stats by work type** over the page window;
 * 2. **stats by device and work type** over the same window (each machine's
 *    slot-hours by work type);
 * 3. **concurrency** per device over the window, at the window's bucket;
 * 4. **growth** over 90 days by day (the sparklines and the trend), which
 *    does not depend on the window.
 *
 * Single-flight with no retries (`COORD_DASHBOARD_POLL_OPTIONS`): the next
 * tick is the retry. Every windowed answer is stamped with the window that
 * produced it, and the hook returns nothing for a stamp that does not match
 * the window on screen (console style guide R6), so changing the window never
 * shows the previous window's figures under the new label.
 *
 * **A failed read keeps the last good body, labelled stale** — except the
 * answers about the data itself (`issueClearsRetained`), which clear it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  fetchSessionRunConcurrency,
  fetchSessionRunGrowth,
  fetchSessionRunStats,
  fetchSessionRuns,
} from "@/lib/api/operations/coordSessionRuns";
import {
  GROWTH_WINDOW,
  classifySessionLoadError,
  isSessionRun,
  issueClearsRetained,
  readConcurrency,
  readGrowth,
  readRunList,
  readStats,
  sessionLoadWindowSpec,
  type ConcurrencyWire,
  type GrowthWire,
  type SessionLoadIssue,
  type SessionLoadReading,
  type SessionLoadWindow,
  type SessionRunWire,
  type StatsWire,
} from "./sessionLoadStatus";

/** Session load moves with sessions, not with a sampler; a minute is plenty. */
export const SESSION_LOAD_POLL_MS = 60_000;

/** Runs per drill-down page (coord's bound is 500). */
export const RUN_PAGE_LIMIT = 100;

export interface LoadPart<T> {
  /** The last good body for THIS window, or `null`. */
  data: T | null;
  /** What the latest read said when it was not a usable body; `null` after a success. */
  issue: SessionLoadIssue | null;
}

export interface SessionLoadRead {
  byType: LoadPart<StatsWire>;
  byDeviceType: LoadPart<StatsWire>;
  concurrency: LoadPart<ConcurrencyWire>;
  growth: LoadPart<GrowthWire>;
  refresh: () => Promise<void> | void;
}

interface Stored {
  window: SessionLoadWindow;
  byType: LoadPart<StatsWire>;
  byDeviceType: LoadPart<StatsWire>;
  concurrency: LoadPart<ConcurrencyWire>;
  growth: LoadPart<GrowthWire>;
}

const EMPTY_PART = { data: null, issue: null } as const;

/** Fold one settled read into the part it answers. */
export function nextPart<T>(
  prev: LoadPart<T>,
  result: PromiseSettledResult<unknown>,
  read: (body: unknown) => SessionLoadReading<T>
): LoadPart<T> {
  if (result.status === "fulfilled") {
    const reading = read(result.value);
    if (reading.kind === "ok") return { data: reading.body, issue: null };
    return {
      data: issueClearsRetained(reading.issue) ? null : prev.data,
      issue: reading.issue,
    };
  }
  const issue = classifySessionLoadError(result.reason);
  return { data: issueClearsRetained(issue) ? null : prev.data, issue };
}

export function useSessionLoad(windowId: SessionLoadWindow): SessionLoadRead {
  const [stored, setStored] = useState<Stored | null>(null);

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      const spec = sessionLoadWindowSpec(windowId);
      const [byType, byDeviceType, concurrency, growth] =
        await Promise.allSettled([
          fetchSessionRunStats(
            windowId,
            "work_type",
            COORD_DASHBOARD_POLL_OPTIONS
          ),
          fetchSessionRunStats(
            windowId,
            "device,work_type",
            COORD_DASHBOARD_POLL_OPTIONS
          ),
          fetchSessionRunConcurrency(
            windowId,
            spec.bucket,
            COORD_DASHBOARD_POLL_OPTIONS
          ),
          fetchSessionRunGrowth(
            GROWTH_WINDOW,
            "day",
            COORD_DASHBOARD_POLL_OPTIONS
          ),
        ]);
      if (!isCurrent()) return;
      setStored((prev) => {
        // A previous window's answer is not retained into this one — except
        // growth, which is the same 90-day question whatever the window.
        const base = prev?.window === windowId ? prev : null;
        return {
          window: windowId,
          byType: nextPart(base?.byType ?? EMPTY_PART, byType, (b) =>
            readStats(b, spec.seconds)
          ),
          byDeviceType: nextPart(
            base?.byDeviceType ?? EMPTY_PART,
            byDeviceType,
            (b) => readStats(b, spec.seconds)
          ),
          concurrency: nextPart(
            base?.concurrency ?? EMPTY_PART,
            concurrency,
            (b) => readConcurrency(b, spec.seconds)
          ),
          growth: nextPart(prev?.growth ?? EMPTY_PART, growth, readGrowth),
        };
      });
    },
    [windowId]
  );

  const { refresh } = useSingleFlightPoll(poll, SESSION_LOAD_POLL_MS, {
    supersedeOnChange: true,
  });

  const current = stored?.window === windowId ? stored : null;
  return {
    byType: current?.byType ?? EMPTY_PART,
    byDeviceType: current?.byDeviceType ?? EMPTY_PART,
    concurrency: current?.concurrency ?? EMPTY_PART,
    growth: stored?.growth ?? EMPTY_PART,
    refresh,
  };
}

export interface RunListFilter {
  windowId: SessionLoadWindow;
  workType: string | null;
  device: string | null;
  initiator: string | null;
}

export type RunListRead =
  | { kind: "loading" }
  | {
      kind: "ok";
      runs: SessionRunWire[];
      unreadable: number;
      total: number | null;
      truncated: boolean;
      nextCursor: string | null;
      asOf: string;
      /** The window start the first page was read from — every later page reuses it. */
      since: string;
      loadingMore: boolean;
      moreIssue: SessionLoadIssue | null;
    }
  | { kind: "issue"; issue: SessionLoadIssue };

function filterKey(f: RunListFilter): string {
  return `${f.windowId}|${f.workType ?? ""}|${f.device ?? ""}|${f.initiator ?? ""}`;
}

/**
 * The drill-down run list for one filter: the first page on mount and on any
 * filter change, further pages on `loadMore`. An answer for another filter is
 * never shown under this one.
 */
export function useSessionRunList(filter: RunListFilter): {
  read: RunListRead;
  loadMore: () => void;
  reload: () => void;
} {
  const key = filterKey(filter);
  const [state, setState] = useState<{ key: string; read: RunListRead } | null>(
    null
  );
  const [nonce, setNonce] = useState(0);
  // Bumped whenever a first page lands: a later page asked for before that,
  // even mid-refresh, belongs to the list it replaced, and appending it would
  // leave a gap.
  const firstPagesLanded = useRef(0);

  useEffect(() => {
    let live = true;
    const since = new Date(
      Date.now() - sessionLoadWindowSpec(filter.windowId).seconds * 1000
    ).toISOString();
    fetchSessionRuns(
      {
        since,
        limit: RUN_PAGE_LIMIT,
        ...(filter.workType ? { workType: filter.workType } : {}),
        ...(filter.device ? { device: filter.device } : {}),
        ...(filter.initiator ? { initiator: filter.initiator } : {}),
      },
      COORD_DASHBOARD_POLL_OPTIONS
    )
      .then((body) => {
        if (!live) return;
        firstPagesLanded.current += 1;
        const reading = readRunList(body);
        if (reading.kind === "issue") {
          setState({ key, read: { kind: "issue", issue: reading.issue } });
          return;
        }
        const rows = reading.body.runs;
        setState({
          key,
          read: {
            kind: "ok",
            runs: rows.filter(isSessionRun),
            unreadable: rows.filter((r) => !isSessionRun(r)).length,
            total:
              typeof reading.body.total === "number"
                ? reading.body.total
                : null,
            truncated: reading.body.truncated === true,
            nextCursor: reading.body.next_cursor ?? null,
            asOf: reading.body.as_of,
            since,
            loadingMore: false,
            moreIssue: null,
          },
        });
      })
      .catch((err: unknown) => {
        if (!live) return;
        firstPagesLanded.current += 1;
        setState({
          key,
          read: { kind: "issue", issue: classifySessionLoadError(err) },
        });
      });
    return () => {
      live = false;
    };
    // `key` captures the filter; `nonce` is the explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const read = useMemo<RunListRead>(
    () => (state?.key === key ? state.read : { kind: "loading" }),
    [state, key]
  );

  const loadMore = useCallback(() => {
    if (read.kind !== "ok" || read.nextCursor === null || read.loadingMore)
      return;
    const cursor = read.nextCursor;
    const extending = firstPagesLanded.current;
    setState({ key, read: { ...read, loadingMore: true, moreIssue: null } });
    fetchSessionRuns(
      {
        cursor,
        limit: RUN_PAGE_LIMIT,
        ...(filter.workType ? { workType: filter.workType } : {}),
        ...(filter.device ? { device: filter.device } : {}),
        ...(filter.initiator ? { initiator: filter.initiator } : {}),
        since: read.since,
      },
      COORD_DASHBOARD_POLL_OPTIONS
    )
      .then((body) => {
        if (extending !== firstPagesLanded.current) return;
        const reading = readRunList(body);
        setState((prev) => {
          if (prev?.key !== key || prev.read.kind !== "ok") return prev;
          if (reading.kind === "issue") {
            return {
              key,
              read: {
                ...prev.read,
                loadingMore: false,
                moreIssue: reading.issue,
              },
            };
          }
          const rows = reading.body.runs;
          return {
            key,
            read: {
              ...prev.read,
              runs: [...prev.read.runs, ...rows.filter(isSessionRun)],
              unreadable:
                prev.read.unreadable +
                rows.filter((r) => !isSessionRun(r)).length,
              truncated: reading.body.truncated === true,
              nextCursor: reading.body.next_cursor ?? null,
              loadingMore: false,
              moreIssue: null,
            },
          };
        });
      })
      .catch((err: unknown) => {
        if (extending !== firstPagesLanded.current) return;
        setState((prev) =>
          prev?.key === key && prev.read.kind === "ok"
            ? {
                key,
                read: {
                  ...prev.read,
                  loadingMore: false,
                  moreIssue: classifySessionLoadError(err),
                },
              }
            : prev
        );
      });
  }, [read, key, filter.workType, filter.device, filter.initiator]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { read, loadMore, reload };
}
