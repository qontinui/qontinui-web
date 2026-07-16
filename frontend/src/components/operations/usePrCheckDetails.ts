"use client";

// ============================================================================
// usePrCheckDetails — on-demand per-PR check breakdown for the pipeline's
// expandable row detail.
// ============================================================================
//
// Plan 2026-07-16-pr-failing-check-details-expandable Phase 2. Fetches the
// web backend's coord proxy
// `GET /operations/pr-merge/prs/{repo}/{pr_number}/checks`
// (coord `pr_state.rs::PrStateResponse`) exactly once per
// (repo, prNumber, head_sha) for the lifetime of the expansion — NO polling:
// the row's aggregate state already live-updates via useMergePipelineData,
// and the breakdown only needs to be as fresh as the head sha it describes.
// The caller renders `failing_contexts` name chips while `loading` or on
// `error`, so this hook never needs a retry loop.

import { useEffect, useReducer, useRef } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import type { CheckRunSummary, PrStateResponse } from "./mergeTypes";

const log = createLogger("usePrCheckDetails");

export interface PrCheckDetails {
  /** Per-check breakdown; null while loading or after a failed fetch. */
  checks: CheckRunSummary[] | null;
  loading: boolean;
  error: string | null;
}

interface CacheEntry {
  checks: CheckRunSummary[] | null;
  error: string | null;
}

/**
 * Fetch the per-check breakdown for a PR, only when `enabled`.
 *
 * `headSha` keys the cache: the result for one head sha is reused across
 * re-renders of the same expansion, while a force-push (new sha) naturally
 * invalidates it. Errors settle into the cache too — the caller's
 * `failing_contexts` fallback is strictly better than hammering a broken
 * endpoint from a 2s-polled dashboard.
 */
export function usePrCheckDetails(
  repo: string,
  prNumber: number | null,
  enabled: boolean,
  headSha: string | null = null
): PrCheckDetails {
  // Per-instance cache — the expansion's lifetime IS this hook instance's
  // lifetime (RowDetail unmounts on collapse), so a plain ref suffices and
  // re-expanding later refetches fresh state by design.
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const [, force] = useReducer((n: number) => n + 1, 0);

  const key =
    enabled && prNumber !== null
      ? `${repo}#${prNumber}@${headSha ?? ""}`
      : null;

  useEffect(() => {
    if (key === null || prNumber === null) return;
    if (cacheRef.current.has(key)) return; // settled — expansion-lifetime cache
    let stale = false;
    (async () => {
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/prs/${encodeURIComponent(repo)}/${prNumber}/checks`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as PrStateResponse;
        cacheRef.current.set(key, {
          checks: Array.isArray(body.checks) ? body.checks : [],
          error: null,
        });
      } catch (err) {
        log.warn("check-details fetch failed", err);
        cacheRef.current.set(key, {
          checks: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!stale) force();
    })();
    return () => {
      stale = true;
    };
  }, [key, repo, prNumber]);

  const entry = key !== null ? cacheRef.current.get(key) : undefined;
  return {
    checks: entry?.checks ?? null,
    loading: key !== null && entry === undefined,
    error: entry?.error ?? null,
  };
}
