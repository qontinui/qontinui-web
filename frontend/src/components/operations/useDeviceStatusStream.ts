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
import {
  indexDeviceStatusRows,
  mergeDeviceStatusRow,
} from "./deviceStatusRows";

const log = createLogger("DeviceStatusStream");

/**
 * Number of consecutive WS reconnect attempts before falling back to
 * pure polling. Same shape as `runners/status` (5 retries with
 * exponential backoff capped at 30s).
 */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Ceiling for the seed retry that runs while the socket is the live feed (see
 * `scheduleSeedRetry`). It starts at `DEVICE_STATUS_POLL_FALLBACK_MS` and
 * doubles per consecutive failure up to this, so a REST route that stays down
 * behind a healthy socket costs at most one read a minute.
 */
const SEED_RETRY_MAX_MS = 60_000;

/**
 * How one fleet read ended.
 *
 * - `ok` / `failed` — the read landed while it was still the CURRENT read, so
 *   its result is now the hook's state.
 * - `superseded_or_unmounted` — a newer read started before this one landed,
 *   or the hook unmounted. The result was discarded: it set no state and armed
 *   nothing. Deliberately not folded into `failed`.
 */
type FleetReadOutcome = "ok" | "failed" | "superseded_or_unmounted";

export interface UseDeviceStatusStreamResult {
  /** hostname (or device_id) → DeviceStatus map, keyed by
   *  `coordDeviceHostKey`, holding each key's NEWEST row
   *  (`deviceStatusRows.ts`). REPLACED with a new Map on every REST seed and
   *  every applied diff, never mutated in place — consumers' `useMemo`s key
   *  on its identity, so that is load-bearing. */
  byHostname: Map<string, DeviceStatus>;
  /** True iff the upstream WS is currently connected. False while
   *  polling fallback is active. */
  connected: boolean;
  /** The last CURRENT fleet read's (REST seed or poll) error message, or
   *  null. Cleared ONLY by a successful fleet read. A pushed frame is one
   *  device's row, not a fleet read, so it never clears this — a REST route
   *  that keeps failing behind a working socket stays reported. A read that
   *  lands after a newer one started is discarded and touches neither this
   *  nor anything else. (The hook keeps no WS-connection error text;
   *  `connected` carries that.) Informational only — the hook keeps trying. */
  error: string | null;
  /** True once the initial REST seed has settled (success OR error).
   *  Lets consumers (`DeviceStatusTile`) distinguish "still loading"
   *  from an honest empty fleet. */
  seeded: boolean;
  /** True once a FLEET read (REST seed or poll) has succeeded at least
   *  once. Unlike `seeded`, a failed read never sets it, and neither does a
   *  pushed frame (one device's row is not a read of the fleet). So
   *  `everSeeded && error` means "serving rows from an earlier fleet read,
   *  and the latest one failed" (possibly stale), while `!everSeeded` means
   *  no fleet read has ever succeeded — though rows may have arrived by
   *  frame. */
  everSeeded: boolean;
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
 * 5. Every fleet read (mount, socket open, tab show, poll, Refresh, retry)
 *    is SEQUENCED: a response that lands after a newer read started is
 *    discarded. When the current read fails while the socket is the live
 *    feed (open, and no polling), ONE retry timer re-reads with capped
 *    backoff until a read succeeds — whichever path the failed read came
 *    from. The retry is owned by a generation: success, polling, socket
 *    close, tab hide and unmount all retire it, so it never runs beside
 *    polling and never outlives its socket.
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
  const [everSeeded, setEverSeeded] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const cleanedUpRef = useRef(false);
  // Fleet-read ordering: every read takes the next number, and only the
  // latest read may write state or arm a retry.
  const readSeqRef = useRef(0);
  // The seed retry: at most one timer, owned by one generation.
  // `clearSeedRetry` bumps the generation, so a timer from an older chain
  // acts on nothing.
  const seedRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const seedRetryGenRef = useRef(0);
  const seedRetryAttemptsRef = useRef(0);
  // `seedFromRest` arms the retry and the retry calls `seedFromRest`; this ref
  // breaks that cycle.
  const scheduleSeedRetryRef = useRef<() => void>(() => {});

  // hostname OR device_id as the key, spelled by `coordDeviceHostKey` — the
  // one key `FleetOverview`'s machine grouping and the devops strip's
  // credential rollup also use, so every consumer finds a device's row under
  // the same key. device_id is the fallback so a row with no hostname still
  // shows. `mergeDeviceStatusRow` never lets an older row from a different
  // device (the retired half of a re-paired box) displace a newer one.
  //
  // A frame is ONE device's row, not a read of the fleet: it neither marks the
  // stream seeded nor clears a fleet-read failure. Letting it do either would
  // hide a REST route that keeps failing behind a working socket.
  const applyRow = useCallback((row: DeviceStatus) => {
    setByHostname((prev) => mergeDeviceStatusRow(prev, row));
  }, []);

  const clearSeedRetry = useCallback(() => {
    seedRetryGenRef.current += 1;
    if (seedRetryTimerRef.current) {
      clearTimeout(seedRetryTimerRef.current);
      seedRetryTimerRef.current = null;
    }
  }, []);

  /**
   * One fleet read, sequenced. Only the CURRENT read — no newer read started,
   * not unmounted — may write state; any other result is discarded. A current
   * read that fails asks for the retry, which arms only if the socket is the
   * live feed.
   */
  const seedFromRest = useCallback(async (): Promise<FleetReadOutcome> => {
    const seq = ++readSeqRef.current;
    const isCurrent = () => !cleanedUpRef.current && seq === readSeqRef.current;
    try {
      const resp = await httpClient.fetch(DEVICE_STATUS_API);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DeviceStatusResponse;
      if (!isCurrent()) return "superseded_or_unmounted";
      // Newest row per key: coord serves newest-first, and a plain set-loop
      // would leave the OLDEST row under a shared hostname.
      setByHostname(indexDeviceStatusRows(data.devices ?? []));
      setError(null);
      setSeeded(true);
      setEverSeeded(true);
      seedRetryAttemptsRef.current = 0;
      clearSeedRetry();
      return "ok";
    } catch (err) {
      if (!isCurrent()) return "superseded_or_unmounted";
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /device-status failed:", msg);
      setError(msg);
      // An error is still an answer — the tile should show its error
      // state, not an indefinite "Loading…".
      setSeeded(true);
      // The trigger is the failure itself, whichever path this read came
      // from (mount, socket open, tab show, Refresh, a retry).
      scheduleSeedRetryRef.current();
      return "failed";
    }
  }, [clearSeedRetry]);

  /**
   * Arm the seed retry after a current fleet read failed — but only while the
   * socket is the live feed: OPEN, no polling running, tab visible, mounted.
   * Otherwise something else already owns re-reading (polling, a reconnect's
   * on-open read, the tab-show read) and a retry would double it.
   *
   * Never more than one timer: arming retires the previous generation first.
   */
  const scheduleSeedRetry = useCallback(() => {
    const ws = wsRef.current;
    if (
      cleanedUpRef.current ||
      document.hidden ||
      pollTimerRef.current !== null ||
      ws === null ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    clearSeedRetry();
    const gen = seedRetryGenRef.current;
    const delay = Math.min(
      DEVICE_STATUS_POLL_FALLBACK_MS *
        Math.pow(2, seedRetryAttemptsRef.current),
      SEED_RETRY_MAX_MS
    );
    seedRetryAttemptsRef.current += 1;
    seedRetryTimerRef.current = setTimeout(() => {
      // A timer from a retired chain touches nothing — not even the ref,
      // which may already hold a newer chain's timer.
      if (gen !== seedRetryGenRef.current) return;
      seedRetryTimerRef.current = null;
      // If this read fails it re-arms through `seedFromRest`'s own rule; if a
      // newer read overtakes it, it is discarded and arms nothing.
      void seedFromRest();
    }, delay);
  }, [clearSeedRetry, seedFromRest]);

  useEffect(() => {
    scheduleSeedRetryRef.current = scheduleSeedRetry;
  }, [scheduleSeedRetry]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    // Polling re-reads the fleet on its own; a retry beside it would double
    // the reads.
    clearSeedRetry();
    pollTimerRef.current = setInterval(() => {
      if (!document.hidden) void seedFromRest();
    }, DEVICE_STATUS_POLL_FALLBACK_MS);
  }, [clearSeedRetry, seedFromRest, stopPolling]);

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
      // A new socket starts its retry backoff from the bottom.
      seedRetryAttemptsRef.current = 0;
      stopPolling();
      // Re-seed once on connect to absorb any updates that landed
      // while we were disconnected — the WS only pushes diffs from
      // here forward. If it fails, `seedFromRest` arms the retry: this
      // socket is now the live feed.
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
      // The retry belonged to this socket; polling takes over re-reading.
      clearSeedRetry();
      seedRetryAttemptsRef.current = 0;
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
  }, [
    applyRow,
    clearSeedRetry,
    closeWs,
    seedFromRest,
    startPolling,
    stopPolling,
  ]);

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
      clearSeedRetry();
    };
  }, [
    seedFromRest,
    connectWs,
    closeWs,
    stopPolling,
    clearReconnect,
    clearSeedRetry,
  ]);

  // Tab visibility — drop the WS while hidden to avoid burning
  // browser-side resources, reconnect on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearReconnect();
        clearSeedRetry();
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
  }, [
    clearReconnect,
    clearSeedRetry,
    closeWs,
    stopPolling,
    seedFromRest,
    connectWs,
  ]);

  const refetch = useCallback(async (): Promise<void> => {
    await seedFromRest();
  }, [seedFromRest]);

  return {
    byHostname,
    connected,
    error,
    seeded,
    everSeeded,
    refetch,
  };
}
