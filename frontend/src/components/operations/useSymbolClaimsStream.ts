"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import {
  SYMBOL_CLAIMS_API,
  SYMBOL_CLAIMS_POLL_MS,
  SYMBOL_CLAIMS_TOP_N,
} from "./utils";
import type { SymbolClaim, SymbolClaimsResponse } from "./types";

const log = createLogger("SymbolClaimsStream");

/**
 * Group + cap helper. Exposed for unit testing — the polling pump
 * just delegates here.
 *
 * - Groups holders by `machine_id`.
 * - Sorts each group by `ttl_seconds` descending (freshest TTL first;
 *   coord defaults Symbol TTL to 300s and `symbol_watcher` heartbeats
 *   on save, so the highest TTL is the most-recently-touched edit).
 * - Caps each group to `topN` entries (defaults to `SYMBOL_CLAIMS_TOP_N`).
 */
export function groupAndCapSymbolClaims(
  holders: SymbolClaim[],
  topN: number = SYMBOL_CLAIMS_TOP_N
): Map<string, SymbolClaim[]> {
  const out = new Map<string, SymbolClaim[]>();
  for (const h of holders) {
    const list = out.get(h.machine_id) ?? [];
    list.push(h);
    out.set(h.machine_id, list);
  }
  for (const [k, list] of out.entries()) {
    list.sort((a, b) => b.ttl_seconds - a.ttl_seconds);
    if (list.length > topN) {
      out.set(k, list.slice(0, topN));
    }
  }
  return out;
}

interface UseSymbolClaimsStreamResult {
  /** machine_id → top-N symbol claims (sorted by TTL desc). */
  byMachine: Map<string, SymbolClaim[]>;
  /** Last fetch error, or null. Informational only — the hook keeps polling. */
  error: string | null;
  /** Force an immediate refetch. */
  refetch: () => Promise<void>;
}

/**
 * Subscribes to live `ClaimKind::Symbol` claims via 30s polling against
 * `GET /api/v1/operations/symbol-claims`. Plan
 * `2026-05-21-coordination-improvements.md` Phase 4.4.
 *
 * Polling cadence — symbol claims churn at human-typing cadence (the
 * supervisor `symbol_watcher` re-acquires on save, default TTL 300s).
 * 30s is fresh-enough for the dashboard sub-line and slow enough to
 * keep coord's Redis SCAN budget unbothered. A WS push channel is a
 * follow-up if dashboard responsiveness ever becomes a concern.
 *
 * Tab-visibility handling: polling pauses while the tab is hidden so
 * we don't burn either the operator's network or coord's CPU on
 * unwatched dashboards. On return, we fire one immediate refetch and
 * resume the interval.
 */
export function useSymbolClaimsStream(): UseSymbolClaimsStreamResult {
  const [byMachine, setByMachine] = useState<Map<string, SymbolClaim[]>>(
    () => new Map()
  );
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanedUpRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const resp = await fetch(SYMBOL_CLAIMS_API, { credentials: "include" });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as SymbolClaimsResponse;
      if (cleanedUpRef.current) return;
      const grouped = groupAndCapSymbolClaims(data.holders ?? []);
      setByMachine(grouped);
      setError(null);
    } catch (err) {
      if (cleanedUpRef.current) return;
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /symbol-claims failed:", msg);
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
    }, SYMBOL_CLAIMS_POLL_MS);
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

  return {
    byMachine,
    error,
    refetch: fetchOnce,
  };
}
