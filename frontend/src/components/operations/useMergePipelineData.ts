"use client";

// ============================================================================
// useMergePipelineData — one data owner for the unified merge-pipeline view.
// ============================================================================
//
// Fleet-page redesign (qontinui-dev-notes/prompts/
// coord-fleet-page-redesign-2026-07-14.md): the MergePipeline hero fuses the
// proposal queue and the PR outer state, so a single hook fetches BOTH plus
// the two actionable side-channels (suggestions, blast-radius gate blocks).
// Transport: WS push on `events.merge.>` with a debounced co-refetch of
// every surface, plus a slow poll fallback. Having ONE owner (instead of
// MergePipeline + MergeTrain each polling) keeps the dashboard at the same
// request budget as before the redesign.
//
// Load discipline (2026-07-21 prod incident): every request in a batch pins
// a backend DB connection for its WHOLE lifetime — the operations proxy
// holds its pooled session across the outbound coord round-trip. So the
// dashboard's request volume is directly a backend connection-pool cost,
// and an unbounded one takes the API down. Three rules keep it bounded:
//
//   1. Single-flight — a batch already in flight absorbs new triggers
//      instead of stacking. Previously a fixed 2s `setInterval` fired
//      regardless of whether the last batch had returned, so rising latency
//      made batches overlap without bound: a textbook positive feedback
//      loop that exhausted the pool (8 + 12 overflow) and 504'd sign-in.
//   2. Gap measured from COMPLETION, not from start — a slow backend
//      stretches the poll gap rather than piling on.
//   3. Hidden tabs don't poll — a backgrounded dashboard left open for
//      hours is pure load with nobody reading it.

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
// Fallback only — the WS is the live transport, so this just bounds staleness
// if the socket is down. 2s here meant 5 authenticated requests every 2s per
// open tab against a 20-connection backend pool.
const POLL_INTERVAL_MS = 15_000;
/**
 * Floor on how often trigger-driven batches (WS push, tab reveal) may START.
 * Single-flight caps CONCURRENCY at one batch but not RATE: without this, a
 * merge-train fan-out emitting events faster than the debounce keeps a batch
 * permanently in flight, which is the same completion-rate-bound load the
 * poll change exists to escape.
 */
const MIN_BATCH_SPACING_MS = 3_000;
/**
 * Lookback for the pipeline's "Merged" tab, forwarded to coord as
 * `?include_merged=<hours>`. coord appends recently-landed PR rows (keyed on
 * the `merge_commit_sha` + `merged_at` land stamp, so BOTH the merge-button
 * path and coord's own fast-forward lands are included) to the open/draft
 * list. A coord deploy that does not honor the param simply returns the open
 * list — the tab renders empty rather than breaking.
 */
export const MERGED_LOOKBACK_HOURS = 48;
const REFETCH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface MergePipelineData {
  /** null while the first fetch is in flight. */
  proposals: ProposalDetail[] | null;
  prs: PrRow[] | null;
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

export function useMergePipelineData(): MergePipelineData {
  const [proposals, setProposals] = useState<ProposalDetail[] | null>(null);
  const [prs, setPrs] = useState<PrRow[] | null>(null);
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
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanedUpRef = useRef(false);
  /** A batch is in flight — new triggers coalesce into `rerunRef`. */
  const inFlightRef = useRef(false);
  /** A trigger arrived mid-batch; run exactly one more batch after it. */
  const rerunRef = useRef(false);
  /** Latest `fetchAll`, so timers/listeners need not re-bind on each change. */
  const fetchAllRef = useRef<() => Promise<void>>(async () => {});
  /** Epoch ms of the last batch START — enforces `MIN_BATCH_SPACING_MS`. */
  const lastBatchStartedAtRef = useRef(0);

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
  const fetchPrs = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/prs?include_merged=${MERGED_LOOKBACK_HOURS}`
      );
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
      log.warn("fetchPrs failed", err);
      if (!cleanedUpRef.current) setPrs([]);
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

  // Reads only refs, so it is stable — `connectWs` (and therefore the WS
  // socket) no longer re-binds whenever a fetch callback identity changes.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    const sinceLast = Date.now() - lastBatchStartedAtRef.current;
    const delay = Math.max(
      REFETCH_DEBOUNCE_MS,
      MIN_BATCH_SPACING_MS - sinceLast
    );
    refetchTimerRef.current = setTimeout(
      () => void fetchAllRef.current(),
      delay
    );
  }, []);

  const fetchAll = useCallback(async () => {
    // Single-flight. Dropping the trigger outright would lose a WS update
    // that landed mid-batch, so remember it and run one more batch after —
    // bounded at one extra batch per completion, never a growing pile.
    if (inFlightRef.current) {
      rerunRef.current = true;
      return;
    }
    inFlightRef.current = true;
    lastBatchStartedAtRef.current = Date.now();
    try {
      // Each fetch* swallows its own errors, so this never rejects; the
      // `finally` is belt-and-braces so the guard cannot latch on.
      await Promise.all([
        fetchQueue(),
        fetchPrs(),
        fetchEconomics(),
        fetchSuggestions(),
        fetchGateBlocks(),
      ]);
    } finally {
      inFlightRef.current = false;
    }
    if (rerunRef.current && !cleanedUpRef.current) {
      rerunRef.current = false;
      scheduleRefetch();
    }
  }, [
    fetchQueue,
    fetchPrs,
    fetchEconomics,
    fetchSuggestions,
    fetchGateBlocks,
    scheduleRefetch,
  ]);

  useEffect(() => {
    fetchAllRef.current = fetchAll;
  }, [fetchAll]);

  const connectWs = useCallback(() => {
    if (cleanedUpRef.current || document.hidden) return;
    // Detach BEFORE closing. A superseded socket's `onclose` fires
    // asynchronously and would otherwise schedule a reconnect that closes the
    // healthy replacement — and since `onopen` zeroes the attempt counter,
    // that ping-pong never hits MAX_RECONNECT_ATTEMPTS.
    const prev = wsRef.current;
    if (prev) {
      prev.onopen = prev.onmessage = prev.onerror = prev.onclose = null;
      prev.close();
    }

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
      // `wsRef.current !== ws` means we have already been superseded.
      if (cleanedUpRef.current || wsRef.current !== ws) return;
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
    // A batch still settling from a previous mount (StrictMode remount) would
    // otherwise leave a stale rerun request armed against this one.
    rerunRef.current = false;
    let stopped = false;

    // Self-rescheduling chain rather than setInterval: the next tick is
    // armed only once the previous batch has SETTLED, so a slow backend can
    // never accumulate overlapping batches.
    const tick = async () => {
      if (stopped || cleanedUpRef.current) return;
      try {
        // `!inFlightRef.current` is load-bearing: a poll tick carries no
        // information, so it must NOT coalesce into `rerunRef` the way a WS
        // event does. If it did, a batch running longer than the poll gap
        // would arm a rerun that starts 250ms after it settles — collapsing
        // the gap to the debounce and making the request rate CLIMB with
        // latency, which is the incident's shape all over again.
        if (!document.hidden && !inFlightRef.current) {
          await fetchAllRef.current();
          // The poll doubles as WS supervisor. `onclose` gives up for good
          // after MAX_RECONNECT_ATTEMPTS (~31s of backoff), so without this a
          // coord restart would strand the page on poll-only freshness until
          // the user happened to hide and re-reveal the tab.
          const ws = wsRef.current;
          if (!ws || ws.readyState > WebSocket.OPEN) {
            reconnectAttemptsRef.current = 0;
            connectWs();
          }
        }
      } catch (err) {
        // Rearming lives in `finally`: this is the ONLY rearm site, so an
        // escaped rejection here would silently kill the fallback poll for
        // the lifetime of the page.
        log.warn("poll tick failed", err);
      } finally {
        if (!stopped && !cleanedUpRef.current) {
          pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      }
    };

    void fetchAllRef.current();
    pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    connectWs();

    // Re-reveal: resync at once, and open the socket if we never got one —
    // `connectWs` no-ops while hidden, so a tab that mounted in the
    // background would otherwise sit with no live transport.
    const onVisibility = () => {
      if (document.hidden || cleanedUpRef.current || stopped) return;
      // Via scheduleRefetch, not a direct call: rapid hide/reveal churn
      // (alt-tab, a monitor sleeping, window-manager events) would otherwise
      // issue an unthrottled batch per reveal.
      scheduleRefetch();
      const ws = wsRef.current;
      if (!ws || ws.readyState > WebSocket.OPEN) {
        // Cancel any pending backoff first, or it fires later and churns the
        // socket we are about to open.
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        connectWs();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      cleanedUpRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      }
    };
  }, [connectWs, scheduleRefetch]);

  return {
    proposals,
    prs,
    economicsByRepo,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    error,
    suggestionBusy,
    onSuggestionAction,
  };
}
