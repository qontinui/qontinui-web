"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlight } from "./useSingleFlightPoll";
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
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@/services/http-client";

const log = createLogger("DeviceStatusStream");

/**
 * Deadline for reading a device-status response BODY. `httpClient`'s abort
 * timer is cleared once headers arrive, so a body that stalls after them would
 * otherwise keep the read in flight forever — and a poll tick starts no read
 * while one is in flight, so polling would stop for good.
 */
const BODY_READ_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

/**
 * One fleet read's cancellables, held by the hook so unmount can reach them:
 * the request's `AbortController` (its signal is handed to `httpClient.fetch`)
 * and the body-deadline timer while one is armed.
 */
interface InFlightRequest {
  controller: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  /** Set when the HOOK cancelled this read (unmount), so its rejection is
   *  discarded rather than reported as a failed read. */
  cancelled: boolean;
}

/**
 * `resp.json()`, rejecting if it has not settled within `ms` — and then
 * ABORTING the request, so a stalled body is cancelled and its connection
 * released, not merely abandoned.
 */
async function readJsonWithDeadline(
  resp: { json: () => Promise<unknown> },
  ms: number,
  request: InFlightRequest
): Promise<unknown> {
  try {
    return await Promise.race([
      resp.json(),
      new Promise<never>((_, reject) => {
        request.deadline = setTimeout(() => {
          request.deadline = undefined;
          // Reject first, so the race settles on the deadline's own error
          // rather than on the body read's abort rejection.
          reject(new Error("device-status response body timed out"));
          request.controller.abort();
        }, ms);
      }),
    ]);
  } finally {
    if (request.deadline !== undefined) {
      clearTimeout(request.deadline);
      request.deadline = undefined;
    }
  }
}

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
 * - `ok` / `failed` — the read landed and no newer read had landed before it,
 *   so its result is now the hook's state.
 * - `superseded_or_unmounted` — a newer read had already landed, or the hook
 *   unmounted. The result was discarded: it set no state and armed nothing.
 *   Deliberately not folded into `failed`.
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
  /** The last applied fleet read's (REST seed or poll) error message, or
   *  null. Cleared ONLY by a successful fleet read. A pushed frame is one
   *  device's row, not a fleet read, so it never clears this — a REST route
   *  that keeps failing behind a working socket stays reported. A read that
   *  lands after a newer one already landed is discarded and touches neither
   *  this nor anything else. (The hook keeps no WS-connection error text;
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
 *    cap 30s). Falls back to 5s polling between attempts; a poll tick
 *    starts no read while another fleet read is still in flight.
 * 5. Fleet reads are ordered by LANDING: a response is discarded only
 *    when a newer read has already landed, or the hook has unmounted. When
 *    an applied read fails while the socket is OPEN and no polling runs,
 *    ONE retry timer re-reads with capped backoff until a read succeeds —
 *    whichever path the failed read came from. Success, polling, socket
 *    close, tab hide and unmount all retire that timer.
 *
 * Socket ownership: `wsRef` holds the one socket this hook owns. Each connect
 * attempt carries a generation; an attempt overtaken while it awaited its token
 * (another connect, tab hide, unmount — including React StrictMode's
 * mount → unmount → mount) creates no socket. Every socket handler first checks
 * it still owns its socket; one that does not touches no shared state and only
 * closes its own socket. Async paths check `cleanedUpRef`, so nothing writes
 * state after unmount.
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
  // Connect attempts: bumped by every attempt and by `closeWs`, so an attempt
  // that awaited its token past either creates no socket.
  const connectGenRef = useRef(0);
  // Fleet-read ordering. Every read takes the next number when it STARTS;
  // `appliedSeqRef` is the newest read whose result LANDED and was applied.
  const readSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  // Every fleet read still in flight — a Set, because a Refresh can overlap a
  // poll or the on-open read. Unmount clears their body deadlines and aborts
  // their requests.
  const inFlightRequestsRef = useRef(new Set<InFlightRequest>());
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
   * One fleet read, ordered by landing. It is discarded only if the hook
   * unmounted or a NEWER read has already landed; otherwise it is applied and
   * becomes the newest landed read. Judging by start order instead starves a
   * slow route: every poll would supersede the one before it, and against a
   * route slower than the interval nothing would ever apply.
   *
   * An applied read that fails asks for the retry, which arms only if the
   * socket is the live feed.
   */
  const seedFromRest = useCallback(async (): Promise<FleetReadOutcome> => {
    const seq = ++readSeqRef.current;
    const request: InFlightRequest = {
      controller: new AbortController(),
      cancelled: false,
    };
    inFlightRequestsRef.current.add(request);
    const claimLanding = (): boolean => {
      if (
        request.cancelled ||
        cleanedUpRef.current ||
        seq < appliedSeqRef.current
      ) {
        return false;
      }
      appliedSeqRef.current = seq;
      return true;
    };
    try {
      // No client retries (plan
      // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5):
      // a failed read is re-read by the next poll or the seed retry, never
      // by `httpClient`'s 5xx backoff chain.
      const resp = await httpClient.fetch(DEVICE_STATUS_API, {
        ...COORD_DASHBOARD_POLL_OPTIONS,
        signal: request.controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      // A stalled body is a failed read (its message lands in `error`) whose
      // request is aborted, and the `finally` below still takes this read out
      // of flight.
      const data = (await readJsonWithDeadline(
        resp,
        BODY_READ_TIMEOUT_MS,
        request
      )) as DeviceStatusResponse;
      if (!claimLanding()) return "superseded_or_unmounted";
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
      if (!claimLanding()) return "superseded_or_unmounted";
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
    } finally {
      inFlightRequestsRef.current.delete(request);
    }
  }, [clearSeedRetry]);

  /**
   * The one door to `seedFromRest` (plan
   * `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5):
   * mount, socket open, tab reveal, Refresh and the seed retry all go through
   * `refreshSeed`, which trails ONE read behind an outstanding one instead of
   * starting a second beside it; a polling tick goes through `tickSeed`, which
   * skips. So at most one fleet read is ever on the wire. The landing-order
   * rule inside `seedFromRest` still holds, and now only ever orders reads
   * that ran one after the other.
   */
  const { refresh: refreshSeed, tick: tickSeed } =
    useSingleFlight(seedFromRest);

  /** Unmount: no body deadline outlives the hook, and no request it started
   *  keeps its connection open. */
  const cancelInFlightReads = useCallback(() => {
    for (const request of inFlightRequestsRef.current) {
      request.cancelled = true;
      if (request.deadline !== undefined) {
        clearTimeout(request.deadline);
        request.deadline = undefined;
      }
      request.controller.abort();
    }
    inFlightRequestsRef.current.clear();
  }, []);

  /**
   * Arm the seed retry after an applied fleet read failed — but only while the
   * socket is the live feed: OPEN, no polling running, tab visible, mounted.
   * Otherwise something else already owns re-reading (polling, a reconnect's
   * on-open read, the tab-show read) and a retry would double it.
   *
   * Idempotent: while a retry is already pending, another failure neither
   * re-arms it nor steps the backoff — two failures landing back to back do
   * not skip a backoff step. So there is never more than one timer.
   */
  const scheduleSeedRetry = useCallback(() => {
    const ws = wsRef.current;
    if (
      cleanedUpRef.current ||
      document.hidden ||
      pollTimerRef.current !== null ||
      ws === null ||
      // By design a failure while the socket is still CONNECTING arms nothing:
      // its `onopen` read re-reads the fleet anyway.
      ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    // Only the current generation's timer is ever held here: `clearSeedRetry`
    // nulls it, and a firing timer nulls it before reading.
    if (seedRetryTimerRef.current !== null) return;
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
      // newer read lands first, it is discarded and arms nothing.
      void refreshSeed();
    }, delay);
  }, [clearSeedRetry, refreshSeed]);

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
      // One fleet read at a time from polling: against a route slower than
      // the interval, ticks would otherwise stack reads on top of each other.
      if (document.hidden) return;
      tickSeed();
    }, DEVICE_STATUS_POLL_FALLBACK_MS);
  }, [clearSeedRetry, tickSeed, stopPolling]);

  const closeWs = useCallback(() => {
    // Retires any connect attempt still awaiting its token, too.
    connectGenRef.current += 1;
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
    const gen = ++connectGenRef.current;

    // Get the per-session WS token — the client-held Cognito bearer when
    // present (hosted-UI sessions never set the HttpOnly cookie), else the
    // cookie-reading /api/v1/ws-token route. Same path the
    // `/api/v1/devices/status` consumer uses.
    const token = await httpClient.getWebSocketToken();

    // Overtaken while awaiting the token — by another connect, `closeWs`
    // (tab hide, unmount), or StrictMode's remount. Create nothing: a socket
    // made here would be one no cleanup can reach.
    if (
      gen !== connectGenRef.current ||
      cleanedUpRef.current ||
      document.hidden
    ) {
      return;
    }

    if (!token) {
      // No token → can't open WS; fall back to polling. The polling
      // path is sufficient for the dashboard even without WS.
      log.debug("No WS token; falling back to polling");
      startPolling();
      return;
    }

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

    // Every handler first checks this is still the hook's own socket. One the
    // hook no longer owns touches no shared state; it only closes itself.
    ws.onopen = () => {
      if (wsRef.current !== ws || cleanedUpRef.current) {
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
      void refreshSeed();
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) {
        ws.close();
        return;
      }
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
      if (wsRef.current !== ws) return;
      setConnected(false);
    };

    ws.onclose = () => {
      // A socket the hook no longer owns is already closed and replaced; its
      // close must not stop the live socket's retry, start polling beside it,
      // or schedule a reconnect that would close it.
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setConnected(false);
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
    refreshSeed,
    startPolling,
    stopPolling,
  ]);

  // Mount: seed + open WS.
  useEffect(() => {
    cleanedUpRef.current = false;
    void refreshSeed();
    void connectWs();
    return () => {
      cleanedUpRef.current = true;
      closeWs();
      stopPolling();
      clearReconnect();
      clearSeedRetry();
      cancelInFlightReads();
    };
  }, [
    refreshSeed,
    connectWs,
    closeWs,
    stopPolling,
    clearReconnect,
    clearSeedRetry,
    cancelInFlightReads,
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
        void refreshSeed();
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
    refreshSeed,
    connectWs,
  ]);

  const refetch = useCallback(async (): Promise<void> => {
    await refreshSeed();
  }, [refreshSeed]);

  return {
    byHostname,
    connected,
    error,
    seeded,
    everSeeded,
    refetch,
  };
}
