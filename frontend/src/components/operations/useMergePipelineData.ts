"use client";

// ============================================================================
// useMergePipelineData — one data owner for the unified merge-pipeline view.
// ============================================================================
//
// Fleet-page redesign (qontinui-dev-notes/prompts/
// coord-fleet-page-redesign-2026-07-14.md): the MergePipeline hero fuses the
// proposal queue and the PR outer state, so a single hook fetches BOTH plus
// the two actionable side-channels (suggestions, blast-radius gate blocks).
// Transport matches the former MergeTrain wiring exactly: WS push on
// `events.merge.>` with a debounced co-refetch of every surface, plus a 2s
// poll fallback. Having ONE owner (instead of MergePipeline + MergeTrain
// each polling) keeps the dashboard at the same request budget as before
// the redesign.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import type {
  BlastRadiusBlock,
  BlastRadiusBlocksResponse,
  MergeEconomics,
  MergeEconomicsResponse,
  PrListResponse,
  PrRow,
  ProposalDetail,
  QueueResponse,
  SuggestionListResponse,
  SuggestionRow,
} from "./mergeTypes";

const log = createLogger("useMergePipelineData");

const COORD_WS_URL =
  process.env.NEXT_PUBLIC_COORD_WS_URL || "ws://localhost:9870/ws";
const WS_PATTERN = "events.merge.>";
const POLL_INTERVAL_MS = 2_000;
/**
 * Lookback for the pipeline's "Merged" tab, forwarded to coord as
 * `?include_merged=<hours>`. coord appends recently-landed PR rows (keyed on
 * the `merge_commit_sha` + `merged_at` land stamp, so BOTH the merge-button
 * path and coord's own fast-forward lands are included) to the open/draft
 * list. A coord deploy that does not honor the param simply returns the open
 * list — the tab renders empty rather than breaking.
 */
export const MERGED_LOOKBACK_HOURS = 48;
/**
 * Cadence for the recently-merged rows — deliberately ~30x slower than the hot
 * poll, and only ticking while the Merged tab is open.
 *
 * `?include_merged=` makes coord run `query_recently_merged_prs`, which
 * resolves a deploy surface per repo (a git-ancestry probe per merged PR) on
 * top of the open-PR scan. Measured against prod on 2026-07-21 the plain
 * endpoint already takes ~31s and 500s at its 30s gateway timeout under load;
 * with `include_merged` it timed out 5/5. Asking for that set on a 2s loop is
 * both useless (landings are minutes apart, not seconds) and actively harmful
 * — it multiplies an already-marginal query by the poll rate. Landing history
 * is cold data; poll it like cold data.
 */
const MERGED_POLL_INTERVAL_MS = 60_000;
const REFETCH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 5;

/** Options for {@link useMergePipelineData}. */
export interface MergePipelineOptions {
  /**
   * Fetch recently-merged rows. False (default) keeps the hot poll on the
   * cheap open-PR query; the caller sets it only while the Merged tab is the
   * visible one.
   */
  includeMerged?: boolean;
}

export interface MergePipelineData {
  /** null while the first fetch is in flight. */
  proposals: ProposalDetail[] | null;
  prs: PrRow[] | null;
  /**
   * Recently-merged rows for the Merged tab. `null` until the first merged
   * fetch resolves, and it only ever runs while the caller passes
   * `includeMerged` — so this stays null for the whole session on the other
   * tabs, which is exactly the point.
   */
  mergedPrs: PrRow[] | null;
  /**
   * Per-repo merge economics keyed by `owner/name`. Never null — it defaults
   * to an empty map, and a 404 / coord-down / not-yet-deployed economics read
   * keeps it empty, so prPipeline transparently falls back to its hardcoded
   * thresholds + repo-name hint. There is no "loading" state to distinguish.
   */
  economicsByRepo: Record<string, MergeEconomics>;
  suggestions: SuggestionRow[] | null;
  gateBlocks: BlastRadiusBlock[] | null;
  gateTotalBlocks: number | null;
  /** Error from the primary (queue) fetch — the actionable surface. */
  error: string | null;
  suggestionBusy: number | null;
  onSuggestionAction: (
    alertId: number,
    action: "accept" | "reject" | "mute",
    body?: Record<string, unknown>
  ) => void;
}

export function useMergePipelineData(
  opts: MergePipelineOptions = {}
): MergePipelineData {
  const includeMerged = opts.includeMerged ?? false;
  const [proposals, setProposals] = useState<ProposalDetail[] | null>(null);
  const [prs, setPrs] = useState<PrRow[] | null>(null);
  const [mergedPrs, setMergedPrs] = useState<PrRow[] | null>(null);
  const [economicsByRepo, setEconomicsByRepo] = useState<
    Record<string, MergeEconomics>
  >({});
  const [suggestions, setSuggestions] = useState<SuggestionRow[] | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState<number | null>(null);
  const [gateBlocks, setGateBlocks] = useState<BlastRadiusBlock[] | null>(null);
  const [gateTotalBlocks, setGateTotalBlocks] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanedUpRef = useRef(false);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/merge/queue`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as QueueResponse | ProposalDetail[];
      const list = Array.isArray(body) ? body : (body.proposals ?? []);
      if (!cleanedUpRef.current) {
        setProposals(list);
        setError(null);
      }
    } catch (err) {
      if (!cleanedUpRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  // Best-effort + 404-tolerant: a coord deploy without the endpoint renders
  // as an empty list, never as an error (the queue fetch owns `error`).
  //
  // The hot poll asks for OPEN PRs only. Merged rows are a separate, much
  // slower fetch (see fetchMergedPrs) because `?include_merged=` is an order
  // of magnitude more expensive server-side.
  const fetchPrs = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/pr-merge/prs`);
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setPrs([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as PrListResponse | PrRow[];
      const list = Array.isArray(body) ? body : (body.prs ?? []);
      if (!cleanedUpRef.current) setPrs(list);
    } catch (err) {
      // Keep the last known-good list. This endpoint is slow enough on a
      // loaded fleet to intermittently 500/504 at the gateway (~30s); wiping
      // to [] on each miss made the whole pipeline blink empty mid-triage,
      // which reads as "nothing to do" rather than "the read failed". 404 is
      // handled above and IS authoritative emptiness.
      log.warn("fetchPrs failed — keeping last known rows", err);
      if (!cleanedUpRef.current) setPrs((prev) => prev ?? []);
    }
  }, []);

  // Recently-merged rows. Fetched ONLY while the caller asks for them (the
  // Merged tab is open) and on a slow cadence — see MERGED_POLL_INTERVAL_MS
  // for why this must never ride the hot poll.
  const fetchMergedPrs = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/prs?include_merged=${MERGED_LOOKBACK_HOURS}`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setMergedPrs([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as PrListResponse | PrRow[];
      const list = Array.isArray(body) ? body : (body.prs ?? []);
      // Keep only the terminal rows; the open ones already arrive via the hot
      // poll, and taking them from here too would double-render every PR.
      if (!cleanedUpRef.current) {
        setMergedPrs(
          list.filter(
            (p) => p.pr_state === "merged" || p.pr_state === "closed"
          )
        );
      }
    } catch (err) {
      log.warn("fetchMergedPrs failed — keeping last known merged rows", err);
      if (!cleanedUpRef.current) setMergedPrs((prev) => prev ?? []);
    }
  }, []);

  // Per-repo merge economics — the CI-duration-aware severity input. Same
  // best-effort + 404-tolerant contract as fetchPrs: coord may not have the
  // `coord_query_merge_economics` read deployed yet (or it may be transiently
  // down), in which case this stays an empty map and prPipeline falls back to
  // its hardcoded thresholds + repo-name hint. Never surfaces an error.
  // Tolerates three wire shapes: an object keyed by `owner/name`, a
  // `{ repos: {...} }` wrapper, or an array of `{ repo, ...economics }`.
  const fetchEconomics = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/merge-economics`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setEconomicsByRepo({});
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | MergeEconomicsResponse
        | Record<string, MergeEconomics>
        | Array<MergeEconomics & { repo?: string }>;
      let map: Record<string, MergeEconomics> = {};
      if (Array.isArray(body)) {
        for (const e of body) {
          if (e && typeof e.repo === "string") map[e.repo] = e;
        }
      } else if (
        body &&
        typeof body === "object" &&
        "repos" in body &&
        body.repos &&
        typeof body.repos === "object"
      ) {
        map = body.repos as Record<string, MergeEconomics>;
      } else if (body && typeof body === "object") {
        // Already keyed by repo.
        map = body as Record<string, MergeEconomics>;
      }
      if (!cleanedUpRef.current) setEconomicsByRepo(map);
    } catch (err) {
      log.warn("fetchEconomics failed", err);
      if (!cleanedUpRef.current) setEconomicsByRepo({});
    }
  }, []);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/suggestions`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setSuggestions([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | SuggestionListResponse
        | SuggestionRow[];
      const list = Array.isArray(body) ? body : (body.suggestions ?? []);
      if (!cleanedUpRef.current) setSuggestions(list);
    } catch (err) {
      log.warn("fetchSuggestions failed", err);
      if (!cleanedUpRef.current) setSuggestions([]);
    }
  }, []);

  const fetchGateBlocks = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/blast-radius-blocks`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) {
            setGateBlocks([]);
            setGateTotalBlocks(0);
          }
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | BlastRadiusBlocksResponse
        | BlastRadiusBlock[];
      const list = Array.isArray(body) ? body : (body.blocks ?? []);
      const total = Array.isArray(body)
        ? body.length
        : (body.total_blocks ?? list.length);
      if (!cleanedUpRef.current) {
        setGateBlocks(list);
        setGateTotalBlocks(total);
      }
    } catch (err) {
      log.warn("fetchGateBlocks failed", err);
      if (!cleanedUpRef.current) {
        setGateBlocks([]);
        setGateTotalBlocks(0);
      }
    }
  }, []);

  const onSuggestionAction = useCallback(
    async (
      alertId: number,
      action: "accept" | "reject" | "mute",
      body?: Record<string, unknown>
    ) => {
      setSuggestionBusy(alertId);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/suggestions/${alertId}/${action}`,
          {
            method: "POST",
            body: JSON.stringify(body ?? {}),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          log.warn(`suggestion ${action} failed`, res.status, text);
          if (!cleanedUpRef.current)
            setError(`Suggestion ${action} failed: HTTP ${res.status}`);
          return;
        }
        await fetchSuggestions();
      } catch (err) {
        log.warn(`suggestion ${action} threw`, err);
        if (!cleanedUpRef.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cleanedUpRef.current) setSuggestionBusy(null);
      }
    },
    [fetchSuggestions]
  );

  const fetchAll = useCallback(() => {
    fetchQueue();
    fetchPrs();
    fetchEconomics();
    fetchSuggestions();
    fetchGateBlocks();
  }, [fetchQueue, fetchPrs, fetchEconomics, fetchSuggestions, fetchGateBlocks]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(fetchAll, REFETCH_DEBOUNCE_MS);
  }, [fetchAll]);

  const connectWs = useCallback(() => {
    if (cleanedUpRef.current || document.hidden) return;
    if (wsRef.current) wsRef.current.close();

    const url = `${COORD_WS_URL}?pattern=${encodeURIComponent(WS_PATTERN)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log.warn("WebSocket constructor failed", err);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (cleanedUpRef.current) {
        ws.close();
        return;
      }
      reconnectAttemptsRef.current = 0;
      // Resync after (re)connect — the snapshot catches anything missed
      // during the disconnect.
      scheduleRefetch();
    };

    ws.onmessage = () => {
      // Merge events only signal "something changed" — refetch for the
      // canonical state.
      scheduleRefetch();
    };

    ws.onerror = (e) => {
      log.warn("WS error", e);
    };

    ws.onclose = () => {
      if (cleanedUpRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        log.warn("WS max reconnect attempts reached; relying on poll");
        return;
      }
      const delay = Math.min(1_000 * 2 ** reconnectAttemptsRef.current, 30_000);
      reconnectAttemptsRef.current += 1;
      reconnectRef.current = setTimeout(connectWs, delay);
    };
  }, [scheduleRefetch]);

  useEffect(() => {
    cleanedUpRef.current = false;
    fetchAll();
    const pollId = setInterval(fetchAll, POLL_INTERVAL_MS);
    connectWs();
    return () => {
      cleanedUpRef.current = true;
      clearInterval(pollId);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchAll, connectWs]);

  // Merged rows ride their OWN slow timer, and only while the caller wants
  // them. Deliberately not folded into `fetchAll`: that is the 2s loop, and
  // the merged query is the expensive one (see MERGED_POLL_INTERVAL_MS).
  // Leaving the Merged tab clears the timer; the last rows stay in state so
  // returning to the tab renders instantly while the refetch runs.
  useEffect(() => {
    if (!includeMerged) return;
    fetchMergedPrs();
    const id = setInterval(fetchMergedPrs, MERGED_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [includeMerged, fetchMergedPrs]);

  return {
    proposals,
    prs,
    mergedPrs,
    economicsByRepo,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    error,
    suggestionBusy,
    onSuggestionAction,
  };
}
