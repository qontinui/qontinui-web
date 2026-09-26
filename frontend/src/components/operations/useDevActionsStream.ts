"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlight } from "./useSingleFlightPoll";
import {
  DEV_ACTIONS_API,
  DEV_ACTIONS_LIMIT,
  DEV_ACTIONS_POLL_MS,
} from "./utils";
import type { DevAction, DevActionsResponse } from "./types";

const log = createLogger("DevActionsStream");

export interface UseDevActionsStreamResult {
  /** Recent dev actions, newest first (as coord returns them). */
  actions: DevAction[];
  /** True once the initial fetch has settled (success OR error). Lets the
   *  tile distinguish "still loading" from an honest empty ledger. */
  seeded: boolean;
  /** Last fetch error, or null. Informational only — the hook keeps polling. */
  error: string | null;
  /** Force an immediate refetch (used by the tile's Refresh button). */
  refetch: () => Promise<void>;
}

/**
 * Subscribes to the dev-action ledger via polling against
 * `GET /api/v1/operations/dev-actions/recent`. Plan
 * `2026-06-07-twin-dev-event-cause-effect-ledger.md`.
 *
 * Polling cadence — dev actions land at agent-execution cadence; 10s
 * (`DEV_ACTIONS_POLL_MS`) is fresh enough for an operator watching the
 * ledger and slow enough to keep coord unbothered. Coord also pushes
 * `events.dev_actions.recorded` on its `/ws`, but the dashboard's existing
 * authenticated WS surfaces (device-status / CI-status) each bridge a
 * single dedicated coord channel through the web backend; there's no
 * generic coord-`/ws` event-fanout bridge to reuse, so polling on the
 * dashboard's refresh cadence is the clean fit here (a dedicated WS bridge
 * is a noted follow-up if responsiveness ever matters).
 *
 * Tab-visibility handling mirrors `useSymbolClaimsStream`: polling pauses
 * while the tab is hidden and fires one immediate refetch on return.
 * Cleanup is exhaustive — every async path checks `cleanedUpRef` so the
 * StrictMode double-mount is safe.
 */
export function useDevActionsStream(): UseDevActionsStreamResult {
  const [actions, setActions] = useState<DevAction[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanedUpRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const resp = await httpClient.fetch(
        `${DEV_ACTIONS_API}?limit=${DEV_ACTIONS_LIMIT}`,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DevActionsResponse;
      if (cleanedUpRef.current) return;
      setActions(data.actions ?? []);
      setError(null);
      setSeeded(true);
    } catch (err) {
      if (cleanedUpRef.current) return;
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /dev-actions/recent failed:", msg);
      setError(msg);
      // An error is still an answer — the tile shows its error state, not
      // an indefinite "Loading…".
      setSeeded(true);
    }
  }, []);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5):
  // every call of `fetchOnce` goes through this latch, so a tick that finds
  // a read outstanding is skipped and a refetch during one runs once after it.
  const { refresh: refreshOnce, tick: tickOnce } = useSingleFlight(fetchOnce);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimerRef.current = setInterval(() => {
      if (!document.hidden) tickOnce();
    }, DEV_ACTIONS_POLL_MS);
  }, [tickOnce, stopPolling]);

  // Mount: seed + start polling.
  useEffect(() => {
    cleanedUpRef.current = false;
    void refreshOnce();
    startPolling();
    return () => {
      cleanedUpRef.current = true;
      stopPolling();
    };
  }, [refreshOnce, startPolling, stopPolling]);

  // Tab-visibility — pause polling while hidden, resume on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void refreshOnce();
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshOnce, startPolling, stopPolling]);

  return {
    actions,
    seeded,
    error,
    refetch: refreshOnce,
  };
}
