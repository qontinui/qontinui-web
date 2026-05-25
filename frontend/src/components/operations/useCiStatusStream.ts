"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import {
  CI_STATUS_API,
  CI_STATUS_POLL_FALLBACK_MS,
  ciStatusWsUrl,
} from "./utils";
import type { CiStatusResponse, RepoCiRow } from "./types";

const log = createLogger("CiStatusStream");

/**
 * Number of consecutive WS reconnect attempts before falling back to
 * pure polling. Same shape as `useDeviceStatusStream` (5 retries with
 * exponential backoff capped at 30s).
 */
const MAX_RECONNECT_ATTEMPTS = 5;

interface UseCiStatusStreamResult {
  /** repo (`owner/name`) → RepoCiRow map. Updates in-place as the WS
   *  pushes diffs; consumers should re-read on every render. */
  byRepo: Map<string, RepoCiRow>;
  /** True iff the upstream WS is currently connected. False while
   *  polling fallback is active. */
  connected: boolean;
  /** Last fetch / WS error message, or null. Informational only —
   *  the hook keeps trying. */
  error: string | null;
  /** Force a REST refetch. */
  refetch: () => Promise<void>;
}

/**
 * Subscribes to live CI-status diffs for the caller's tenant. Plan
 * `2026-05-25-ci-status-dashboard-plan.md` Phase 3.
 *
 * Mirrors `useDeviceStatusStream` exactly:
 * 1. On mount, fetch `GET /api/v1/operations/ci-status` to seed the map.
 * 2. Fetch a short-lived WS auth token via `/api/v1/ws-token`.
 * 3. Open `WS /api/v1/operations/ci-status/ws?token=<jwt>`. On each
 *    pushed `{kind:"ci_status.changed", row}` frame, update the map
 *    keyed by `repo`.
 * 4. On WS error/close, exponential-backoff reconnect (5 attempts,
 *    cap 30s). Falls back to 5s polling between attempts and after the
 *    cap is reached.
 *
 * The backend handles the coord-side subscribe (topic
 * `ci_status:<tenant>`); the browser just consumes frames.
 */
export function useCiStatusStream(): UseCiStatusStreamResult {
  const [byRepo, setByRepo] = useState<Map<string, RepoCiRow>>(
    () => new Map(),
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const cleanedUpRef = useRef(false);

  const applyRow = useCallback((row: RepoCiRow) => {
    setByRepo((prev) => {
      const next = new Map(prev);
      next.set(row.repo, row);
      return next;
    });
  }, []);

  const seedFromRest = useCallback(async (): Promise<void> => {
    try {
      const resp = await httpClient.fetch(CI_STATUS_API);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as CiStatusResponse;
      if (cleanedUpRef.current) return;
      const seeded = new Map<string, RepoCiRow>();
      for (const row of data.repos ?? []) {
        seeded.set(row.repo, row);
      }
      setByRepo(seeded);
      setError(null);
    } catch (err) {
      if (cleanedUpRef.current) return;
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /ci-status failed:", msg);
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
      if (!document.hidden) void seedFromRest();
    }, CI_STATUS_POLL_FALLBACK_MS);
  }, [seedFromRest, stopPolling]);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      try {
        wsRef.current.close();
      } catch {
        // Already closed — ignore.
      }
      wsRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectWs = useCallback(async (): Promise<void> => {
    if (cleanedUpRef.current || document.hidden) return;
    closeWs();

    // Fetch the per-session WS token (reads HttpOnly cookie server-side
    // and returns the bearer string). Same path the device-status
    // consumer uses.
    let token: string | null = null;
    try {
      const tokResp = await httpClient.fetch(
        `${ApiConfig.API_BASE_URL}/api/v1/ws-token`,
      );
      if (tokResp.ok) {
        const data = (await tokResp.json()) as { token?: string };
        token = data.token ?? null;
      }
    } catch (err) {
      log.warn("Failed to fetch ws-token", err);
    }

    if (!token) {
      // No token → can't open WS; fall back to polling. The polling
      // path is sufficient for the dashboard even without WS.
      log.debug("No WS token; falling back to polling");
      startPolling();
      return;
    }

    if (cleanedUpRef.current) return;

    const url = ciStatusWsUrl(token);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log.warn("WebSocket construction failed", err);
      startPolling();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (cleanedUpRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      stopPolling();
      // Re-seed once on connect to absorb any updates that landed while
      // we were disconnected — the WS only pushes diffs from here on.
      void seedFromRest();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          kind?: string;
          row?: RepoCiRow;
          type?: string;
          error?: string;
        };
        if (payload.type === "error") {
          log.warn("ci-status WS server error:", payload.error);
          return;
        }
        if (payload.kind === "ci_status.changed" && payload.row) {
          applyRow(payload.row);
        }
      } catch (err) {
        log.warn("ci-status WS parse failed", err);
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
      if (cleanedUpRef.current || document.hidden) return;

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current),
          30_000,
        );
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          void connectWs();
        }, delay);
      }
      // Whether reconnect is pending or maxed out, start polling so the
      // operator keeps seeing fresh data.
      startPolling();
    };
  }, [applyRow, closeWs, seedFromRest, startPolling, stopPolling]);

  // Mount: seed + open WS.
  useEffect(() => {
    cleanedUpRef.current = false;
    void seedFromRest();
    void connectWs();
    return () => {
      cleanedUpRef.current = true;
      closeWs();
      stopPolling();
      clearReconnect();
    };
  }, [seedFromRest, connectWs, closeWs, stopPolling, clearReconnect]);

  // Tab visibility — drop the WS while hidden to avoid burning
  // browser-side resources, reconnect on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearReconnect();
        closeWs();
        stopPolling();
        setConnected(false);
      } else {
        reconnectAttemptsRef.current = 0;
        void seedFromRest();
        void connectWs();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, [clearReconnect, closeWs, stopPolling, seedFromRest, connectWs]);

  return {
    byRepo,
    connected,
    error,
    refetch: seedFromRest,
  };
}
