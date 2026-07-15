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
const REFETCH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface MergePipelineData {
  /** null while the first fetch is in flight. */
  proposals: ProposalDetail[] | null;
  prs: PrRow[] | null;
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
      log.warn("fetchPrs failed", err);
      if (!cleanedUpRef.current) setPrs([]);
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
    fetchSuggestions();
    fetchGateBlocks();
  }, [fetchQueue, fetchPrs, fetchSuggestions, fetchGateBlocks]);

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

  return {
    proposals,
    prs,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    error,
    suggestionBusy,
    onSuggestionAction,
  };
}
