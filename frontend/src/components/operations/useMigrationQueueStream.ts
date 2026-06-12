"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { MIGRATIONS_QUEUE_POLL_MS, migrationsQueueUrl } from "./utils";
import type { MigrationQueueResponse, MigrationReservation } from "./types";

const log = createLogger("MigrationQueueStream");

export interface UseMigrationQueueStreamResult {
  /** The ordered live queue (oldest-first; each row carries `position`). */
  live: MigrationReservation[];
  /** The last few terminal rows (newest-first), for recent context. */
  recentTerminal: MigrationReservation[];
  /** True once the initial fetch for the current repo has settled (success
   *  OR error). Lets the tile distinguish "still loading" from an honest
   *  empty queue. */
  seeded: boolean;
  /** Last fetch error, or null. Informational only — the hook keeps polling. */
  error: string | null;
  /** Force an immediate refetch (used by the tile's Refresh button). */
  refetch: () => Promise<void>;
}

/**
 * Polls the coord-authoritative migration reservation queue for `repo` via
 * `GET /api/v1/operations/migrations/queue?repo=`. The queue is per-repo, so
 * the hook re-seeds whenever `repo` changes.
 *
 * Polling cadence — reservations transition at author/merge cadence (a slot
 * is taken, a PR binds, a merge flips it); `MIGRATIONS_QUEUE_POLL_MS` (15s)
 * surfaces a transition within ~1 frame without hot-looping coord. Coord has
 * no dedicated push channel for this surface, so polling on the dashboard's
 * refresh cadence is the clean fit (mirrors `useDevActionsStream`).
 *
 * Tab-visibility handling pauses polling while the tab is hidden and fires
 * one immediate refetch on return. Cleanup is exhaustive — every async path
 * checks `cleanedUpRef` so the React StrictMode double-mount is safe.
 */
export function useMigrationQueueStream(
  repo: string
): UseMigrationQueueStreamResult {
  const [live, setLive] = useState<MigrationReservation[]>([]);
  const [recentTerminal, setRecentTerminal] = useState<MigrationReservation[]>(
    []
  );
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanedUpRef = useRef(false);
  // Track the repo the in-flight fetch was issued for, so a slow response
  // for a stale repo can't clobber the current selection's data.
  const repoRef = useRef(repo);
  repoRef.current = repo;

  const fetchOnce = useCallback(async (): Promise<void> => {
    const requested = repoRef.current;
    // An empty repo can't be queried (coord 400s) — present it as an empty,
    // settled queue rather than firing a doomed request.
    if (!requested.trim()) {
      if (cleanedUpRef.current) return;
      setLive([]);
      setRecentTerminal([]);
      setError(null);
      setSeeded(true);
      return;
    }
    try {
      const resp = await httpClient.fetch(migrationsQueueUrl(requested));
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as MigrationQueueResponse;
      // Drop the response if the operator switched repos mid-flight.
      if (cleanedUpRef.current || repoRef.current !== requested) return;
      setLive(data.live ?? []);
      setRecentTerminal(data.recent_terminal ?? []);
      setError(null);
      setSeeded(true);
    } catch (err) {
      if (cleanedUpRef.current || repoRef.current !== requested) return;
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn(`GET /migrations/queue?repo=${requested} failed:`, msg);
      setError(msg);
      // An error is still an answer — the tile shows its error state, not an
      // indefinite "Loading…".
      setSeeded(true);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimerRef.current = setInterval(() => {
      if (!document.hidden) void fetchOnce();
    }, MIGRATIONS_QUEUE_POLL_MS);
  }, [fetchOnce, stopPolling]);

  // Mount + repo change: re-seed and (re)start polling. Resetting `seeded`
  // makes the tile show its loading state while the new repo's first fetch
  // is in flight.
  useEffect(() => {
    cleanedUpRef.current = false;
    setSeeded(false);
    void fetchOnce();
    startPolling();
    return () => {
      cleanedUpRef.current = true;
      stopPolling();
    };
  }, [repo, fetchOnce, startPolling, stopPolling]);

  // Tab-visibility — pause polling while hidden, resume on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void fetchOnce();
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchOnce, startPolling, stopPolling]);

  return { live, recentTerminal, seeded, error, refetch: fetchOnce };
}
