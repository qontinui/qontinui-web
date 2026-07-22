"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import {
  DEVICE_STATUS_API,
  DEVICE_STATUS_POLL_FALLBACK_MS,
  deviceStatusWsUrl,
} from "./utils";
import type { DeviceStatus, DeviceStatusResponse } from "./types";

const log = createLogger("DeviceStatusStream");

/**
 * Number of consecutive WS reconnect attempts before falling back to
 * pure polling. Same shape as `runners/status` (5 retries with
 * exponential backoff capped at 30s).
 */
const MAX_RECONNECT_ATTEMPTS = 5;

export interface UseDeviceStatusStreamResult {
  /** hostname → DeviceStatus map. Updates in-place as the WS pushes
   *  diffs; consumers should re-read on every render. */
  byHostname: Map<string, DeviceStatus>;
  /** True iff the upstream WS is currently connected. False while
   *  polling fallback is active. */
  connected: boolean;
  /** Last fetch / WS error message, or null. Informational only —
   *  the hook keeps trying. */
  error: string | null;
  /** True once the initial REST seed has settled (success OR error).
   *  Lets consumers (`DeviceStatusTile`) distinguish "still loading"
   *  from an honest empty fleet. */
  seeded: boolean;
  /** Force a REST refetch (used by the `Refresh` button on the UI). */
  refetch: () => Promise<void>;
}

/**
 * Subscribes to live `coord.device_status` diffs for the caller's
 * tenant. Plan `2026-05-21-coordination-improvements.md` Phase 1.3.
 *
 * Flow:
 * 1. On mount, fetch `GET /api/v1/operations/device-status` to seed
 *    the map.
 * 2. Fetch a short-lived WS auth token via `/api/v1/ws-token` (same
 *    `HttpOnly` cookie → bearer-string flip the rest of the app uses).
 * 3. Open `WS /api/v1/operations/device-status/ws?token=<jwt>`. On
 *    each pushed `{kind:"device_status.changed", row}` frame, update
 *    the map keyed by hostname (or `device_id` when hostname is null).
 * 4. On WS error/close, exponential-backoff reconnect (5 attempts,
 *    cap 30s). Falls back to 5s polling between attempts.
 *
 * Cleanup discipline mirrors the pattern in
 * `realtime-connections-context.tsx`: every async path checks the
 * `cleanedUpRef` flag set by the unmount cleanup, and timers/sockets
 * are torn down inside a `finally` to make the React StrictMode
 * double-mount safe.
 */
export function useDeviceStatusStream(): UseDeviceStatusStreamResult {
  const [byHostname, setByHostname] = useState<Map<string, DeviceStatus>>(
    () => new Map()
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const cleanedUpRef = useRef(false);

  // hostname OR device_id as the key — hostname is preferred so we
  // can join cleanly to the existing MachineCard hostname grouping.
  // device_id is the fallback so a row with no hostname still shows.
  const keyOf = useCallback(
    (row: DeviceStatus): string => row.hostname ?? row.device_id,
    []
  );

  const applyRow = useCallback(
    (row: DeviceStatus) => {
      setByHostname((prev) => {
        const next = new Map(prev);
        next.set(keyOf(row), row);
        return next;
      });
    },
    [keyOf]
  );

  const seedFromRest = useCallback(async (): Promise<void> => {
    try {
      const resp = await httpClient.fetch(DEVICE_STATUS_API);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DeviceStatusResponse;
      if (cleanedUpRef.current) return;
      const next = new Map<string, DeviceStatus>();
      for (const row of data.devices ?? []) {
        next.set(row.hostname ?? row.device_id, row);
      }
      setByHostname(next);
      setError(null);
      setSeeded(true);
    } catch (err) {
      if (cleanedUpRef.current) return;
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /device-status failed:", msg);
      setError(msg);
      // An error is still an answer — the tile should show its error
      // state, not an indefinite "Loading…".
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
      if (!document.hidden) void seedFromRest();
    }, DEVICE_STATUS_POLL_FALLBACK_MS);
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

    // Get the per-session WS token — the client-held Cognito bearer when
    // present (hosted-UI sessions never set the HttpOnly cookie), else the
    // cookie-reading /api/v1/ws-token route. Same path the
    // `/api/v1/devices/status` consumer uses.
    const token = await httpClient.getWebSocketToken();

    if (!token) {
      // No token → can't open WS; fall back to polling. The polling
      // path is sufficient for the dashboard even without WS.
      log.debug("No WS token; falling back to polling");
      startPolling();
      return;
    }

    if (cleanedUpRef.current) return;

    const url = deviceStatusWsUrl(token);
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
      // Re-seed once on connect to absorb any updates that landed
      // while we were disconnected — the WS only pushes diffs from
      // here forward.
      void seedFromRest();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          kind?: string;
          row?: DeviceStatus;
          type?: string;
          error?: string;
        };
        if (payload.type === "error") {
          log.warn("device-status WS server error:", payload.error);
          return;
        }
        if (payload.kind === "device_status.changed" && payload.row) {
          applyRow(payload.row);
        }
      } catch (err) {
        log.warn("device-status WS parse failed", err);
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
          30_000
        );
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          void connectWs();
        }, delay);
      }
      // Whether reconnect is pending or maxed out, start polling so
      // the operator keeps seeing fresh data.
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
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearReconnect, closeWs, stopPolling, seedFromRest, connectWs]);

  return {
    byHostname,
    connected,
    error,
    seeded,
    refetch: seedFromRest,
  };
}
