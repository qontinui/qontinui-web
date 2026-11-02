"use client";

/**
 * The spawn ledger reads behind `/admin/coord/spawns`, polled — and the one
 * request timeline a row's detail reads on demand.
 *
 * Transport: the web backend's passthrough proxies (`/api/v1/operations/
 * spawns…`, through `@/lib/api/operations/coordSpawns`). **Never call coord
 * from the browser.**
 *
 * One poll asks three questions:
 *
 * 1. the window's **stats** — read first, because coord's `window_start` is
 *    where the list should begin, and a body answering another window than
 *    the one asked is refused (`readSpawnStats`);
 * 2. the window's **requests**, `since` that `window_start` (or, when the
 *    stats read gave none, the page clock's window start);
 * 3. the requests **still waiting**, whatever their age
 *    (`state=queued,dispatched,deferred`, no `since`), OLDEST first
 *    (`order=asc`), so a page cut at coord's 200-row bound keeps the
 *    longest-waiting ones — the population a window-scoped list hides, and the
 *    one the plan was written about.
 *
 * Single-flight with no retries (`COORD_DASHBOARD_POLL_OPTIONS`): the next
 * tick is the retry.
 *
 * **Every stored answer is stamped with the window that produced it**, and the
 * hook returns nothing for a stamp that does not match the window on screen
 * (console style guide R6, "a filter set is a list route's param"): changing
 * the window must never show the previous window's rows under the new label.
 *
 * **A failed read keeps the last good body, labelled stale** — except for the
 * answers that are about the data itself (`issueClearsRetained`: the ledger is
 * not deployed, the caller may not read it), which clear it. `{available:
 * false}` is one of those: rows beside it would contradict it.
 */

import { useCallback, useEffect, useState } from "react";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  fetchSpawn,
  fetchSpawnStats,
  fetchSpawns,
  type SpawnStatsWindow,
} from "@/lib/api/operations/coordSpawns";
import {
  PENDING_STATES,
  classifySpawnError,
  issueClearsRetained,
  readSpawnDetail,
  readSpawnList,
  readSpawnStats,
  windowSpec,
  type SpawnBodyReading,
  type SpawnDetailWire,
  type SpawnListWire,
  type SpawnReadIssue,
  type SpawnStatsWire,
} from "./spawnStatus";

/** The ledger moves with spawns, not with a sampler; 30 s matches the computers page. */
export const SPAWNS_POLL_MS = 30_000;

/** coord's page bound for `GET /coord/spawns`. */
export const SPAWNS_PAGE_LIMIT = 200;

export interface LedgerPart<T> {
  /** The last good body for THIS window, or `null`. */
  data: T | null;
  /** What the latest read said when it was not a usable body; `null` after a success. */
  issue: SpawnReadIssue | null;
}

export interface SpawnLedgerRead {
  /** Requests made in the window. */
  list: LedgerPart<SpawnListWire>;
  /** The requests still waiting, whatever their age — oldest first, to coord's page bound. */
  pending: LedgerPart<SpawnListWire>;
  stats: LedgerPart<SpawnStatsWire>;
  refresh: () => Promise<void> | void;
}

interface Stored {
  window: SpawnStatsWindow;
  list: LedgerPart<SpawnListWire>;
  pending: LedgerPart<SpawnListWire>;
  stats: LedgerPart<SpawnStatsWire>;
}

const EMPTY_PART = { data: null, issue: null } as const;

/** Fold one settled read into the part it answers. */
function nextPart<T>(
  prev: LedgerPart<T>,
  result: PromiseSettledResult<unknown>,
  read: (body: unknown) => SpawnBodyReading<T>
): LedgerPart<T> {
  if (result.status === "fulfilled") {
    const reading = read(result.value);
    if (reading.kind === "ok") return { data: reading.body, issue: null };
    return {
      data: issueClearsRetained(reading.issue) ? null : prev.data,
      issue: reading.issue,
    };
  }
  const issue = classifySpawnError(result.reason);
  return { data: issueClearsRetained(issue) ? null : prev.data, issue };
}

/**
 * The ledger for a window. `null` is a window not yet decided (a page still
 * reading which window a link asked for): nothing is read until it is, so the
 * first read is the one for the window the page shows.
 */
export function useSpawnLedger(
  windowId: SpawnStatsWindow | null
): SpawnLedgerRead {
  const [stored, setStored] = useState<Stored | null>(null);

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      if (windowId === null) return;
      const [stats] = await Promise.allSettled([
        fetchSpawnStats(windowId, COORD_DASHBOARD_POLL_OPTIONS),
      ]);
      const statsReading =
        stats.status === "fulfilled"
          ? readSpawnStats(stats.value, windowId)
          : null;
      // coord's own window start, so the list covers exactly what the strip
      // aggregates; the page clock's only when coord gave none.
      const since =
        statsReading?.kind === "ok"
          ? statsReading.body.window_start
          : new Date(Date.now() - windowSpec(windowId).ms).toISOString();
      const [list, pending] = await Promise.allSettled([
        fetchSpawns(
          { since, limit: SPAWNS_PAGE_LIMIT },
          COORD_DASHBOARD_POLL_OPTIONS
        ),
        // Oldest first: when more than a page is waiting, the page keeps the
        // longest-waiting requests — the stuck ones — rather than cutting them.
        fetchSpawns(
          {
            states: [...PENDING_STATES],
            order: "asc",
            limit: SPAWNS_PAGE_LIMIT,
          },
          COORD_DASHBOARD_POLL_OPTIONS
        ),
      ]);
      if (!isCurrent()) return;
      setStored((prev) => {
        // A previous window's answer is not retained into this one.
        const base = prev?.window === windowId ? prev : null;
        return {
          window: windowId,
          stats: nextPart(base?.stats ?? EMPTY_PART, stats, (body) =>
            readSpawnStats(body, windowId)
          ),
          list: nextPart(base?.list ?? EMPTY_PART, list, readSpawnList),
          pending: nextPart(
            base?.pending ?? EMPTY_PART,
            pending,
            readSpawnList
          ),
        };
      });
    },
    [windowId]
  );

  const { refresh } = useSingleFlightPoll(poll, SPAWNS_POLL_MS, {
    supersedeOnChange: true,
  });

  const current = stored?.window === windowId ? stored : null;
  return {
    list: current?.list ?? EMPTY_PART,
    pending: current?.pending ?? EMPTY_PART,
    stats: current?.stats ?? EMPTY_PART,
    refresh,
  };
}

export type SpawnDetailRead =
  | { kind: "loading" }
  | { kind: "ok"; detail: SpawnDetailWire }
  | { kind: "issue"; issue: SpawnReadIssue };

/**
 * One request's timeline, read when its row opens. `version` is the row's
 * `updated_at`: when the poll brings a newer row the timeline is read again,
 * so an open detail does not keep describing a state the row has left.
 */
export function useSpawnDetail(
  spawnId: string,
  version: string
): SpawnDetailRead {
  const [read, setRead] = useState<{
    key: string;
    value: SpawnDetailRead;
  } | null>(null);
  const key = `${spawnId}@${version}`;

  useEffect(() => {
    let live = true;
    fetchSpawn(spawnId, COORD_DASHBOARD_POLL_OPTIONS)
      .then((body) => {
        if (!live) return;
        const reading = readSpawnDetail(body);
        setRead({
          key,
          value:
            reading.kind === "ok"
              ? { kind: "ok", detail: reading.body }
              : { kind: "issue", issue: reading.issue },
        });
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRead({
          key,
          value: {
            kind: "issue",
            issue: classifySpawnError(err, { detail: true }),
          },
        });
      });
    return () => {
      live = false;
    };
  }, [spawnId, key]);

  // An answer for another id or an older version is not this row's timeline.
  return read?.key === key ? read.value : { kind: "loading" };
}
