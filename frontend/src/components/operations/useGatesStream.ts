"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { GATES_LIST_API, GATES_POLL_MS } from "./utils";
import type { GateRow } from "./types";

const log = createLogger("GatesStream");

interface UseGatesStreamResult {
  /** The tenant's gates, freshest fetch. `null` until the first fetch
   *  resolves so the panel can distinguish "loading" from "empty". */
  gates: GateRow[] | null;
  /** Last fetch error, or null. Informational — the hook keeps polling. */
  error: string | null;
  /** Force an immediate refetch (e.g. after an approve/mute/snooze action). */
  refetch: () => Promise<void>;
}

/**
 * Subscribes to the tenant's gates via polling against
 * `GET /api/v1/operations/gates/list`. Plan
 * `2026-06-05-plan-gate-web-surface-and-productization` Phase 2.
 *
 * Polling cadence — gates evaluate at coord's leader-gated sweep cadence
 * (10s default) and verdicts flip slowly, so 15s polling surfaces a flip
 * within ~2 sweeps without hot-looping the proxy. A WS push channel is a
 * follow-up if responsiveness ever matters.
 *
 * Tab-visibility handling mirrors `useSymbolClaimsStream`: polling pauses
 * while the tab is hidden and fires one immediate refetch on return.
 *
 * The list endpoint returns a bare JSON array of `GateRow` (coord's
 * `GET /coord/gates` serializes `Vec<GateResponse>`); we tolerate either a
 * bare array OR a `{gates: [...]}` envelope defensively in case the proxy
 * shape changes.
 */
export function useGatesStream(): UseGatesStreamResult {
  const [gates, setGates] = useState<GateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanedUpRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const resp = await httpClient.fetch(GATES_LIST_API);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data: unknown = await resp.json();
      if (cleanedUpRef.current) return;
      const rows: GateRow[] = Array.isArray(data)
        ? (data as GateRow[])
        : ((data as { gates?: GateRow[] })?.gates ?? []);
      setGates(rows);
      setError(null);
    } catch (err) {
      if (cleanedUpRef.current) return;
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /gates/list failed:", msg);
      setError(msg);
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
    }, GATES_POLL_MS);
  }, [fetchOnce, stopPolling]);

  // Mount: seed + start polling. Cleanup is exhaustive — StrictMode
  // double-mount is safe because every async path checks
  // `cleanedUpRef.current` before touching state.
  useEffect(() => {
    cleanedUpRef.current = false;
    void fetchOnce();
    startPolling();
    return () => {
      cleanedUpRef.current = true;
      stopPolling();
    };
  }, [fetchOnce, startPolling, stopPolling]);

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

  return { gates, error, refetch: fetchOnce };
}
