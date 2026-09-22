"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { isRunnerReachable } from "@/lib/ui-bridge/discovered-specs";
import {
  describeRunnerOriginRefusal,
  readRunnerOriginRefusal,
  type RunnerOriginRefusal,
} from "./origin-refusal";

// =============================================================================
// Configuration
// =============================================================================

export const RUNNER_API_BASE = "http://localhost:9876";

/**
 * Is this base URL a loopback address? Loopback is only reachable when the
 * page itself is served from a localhost origin — production pages
 * (qontinui.io) physically cannot fetch it (Chrome's Local Network Access
 * blocks public→loopback), so every poll was a guaranteed
 * `net::ERR_FAILED` console line (~6/min per page from useRunnerHealth
 * alone, observed live 2026-06-07). Same rationale and origin gate as
 * `discovered-specs.ts`. A non-loopback base (e.g. a future remote/tunnel
 * runner) is never gated.
 */
function isLoopbackBase(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * True when no runner call can succeed from this page's origin: it is not a
 * localhost origin, and the active runner is (or would be) reached over
 * loopback.
 */
function isRunnerUnreachableFromOrigin(transport: RunnerTransport): boolean {
  if (isRunnerReachable()) return false;
  return transport.kind === "no_loopback" || isLoopbackBase(transport.base);
}

export const DEFAULT_POLL_INTERVAL = 5000;
export const HEALTH_POLL_INTERVAL = 10000;

// =============================================================================
// Active transport
// =============================================================================

/**
 * Why the active runner has no loopback base from this browser.
 *
 * - `not_local`        — measured: the runner is on another machine.
 * - `locality_unknown` — measured, but no answer proved it is on this machine.
 * - `list_unavailable` — the runner list could not be loaded, so there is no
 *                        runner to prove local at all.
 * - `measuring`        — the locality probe has not answered yet.
 *
 * None of them falls back to `RUNNER_API_BASE`: that would reach whatever owns
 * :9876 on THIS box, which is the wrong-box defect (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 1).
 */
export type RunnerNoLoopbackReason =
  | "not_local"
  | "locality_unknown"
  | "list_unavailable"
  | "measuring";

export type RunnerLoopbackTransport = { kind: "loopback"; base: string };

export type RunnerTransport =
  | RunnerLoopbackTransport
  | {
      kind: "no_loopback";
      reason: RunnerNoLoopbackReason;
      runnerName?: string;
    };

/** RunnerApiError.code when the active runner is measured to be on another machine. */
export const RUNNER_NOT_LOCAL = "RUNNER_NOT_LOCAL";
/** RunnerApiError.code when the active runner's locality is not (yet) proven. */
export const RUNNER_LOCALITY_UNKNOWN = "RUNNER_LOCALITY_UNKNOWN";
/** RunnerApiError.code when the runner list itself could not be loaded. */
export const RUNNER_LIST_UNAVAILABLE = "RUNNER_LIST_UNAVAILABLE";
/**
 * RunnerApiError.code when this page's origin cannot reach loopback at all
 * (a non-localhost origin). Distinct from RUNNER_NOT_LOCAL: it says nothing
 * about which machine the runner is on.
 */
export const RUNNER_ORIGIN_UNREACHABLE = "RUNNER_ORIGIN_UNREACHABLE";

/**
 * How long runnerFetch waits, while the transport is `measuring`, before
 * refusing. `measuring` now spans the runner-list load (a backend REST call,
 * or the WebSocket's initial_state) AND the locality probes after it
 * (LOCALITY_PROBE_TIMEOUT_MS each, run in parallel). The wait ends as soon
 * as the provider publishes a definite transport, so this bound only matters
 * when that never happens — e.g. no ActiveRunnerProvider is mounted, or the
 * list load hangs. 8 s covers a slow cold list load plus one probe timeout
 * with margin, while still failing a call that nothing will ever resolve
 * well inside a user's patience.
 */
const MEASURING_WAIT_MS = 8000;

// Mutable transport for multi-runner support. It starts as `measuring`: no
// runner call may reach a loopback port before ActiveRunnerProvider has
// resolved which runner is active and proven it local — child effects run
// before the provider's, so a loopback default here would let the first
// queries of every page hit whatever owns :9876 on this box. The provider
// sets the default `RUNNER_API_BASE` only once the runner list has loaded
// and is genuinely empty.
let _runnerTransport: RunnerTransport = {
  kind: "no_loopback",
  reason: "measuring",
};

type TransportChangeListener = (transport: RunnerTransport) => void;
const _transportListeners = new Set<TransportChangeListener>();

export function transportKey(transport: RunnerTransport): string {
  return transport.kind === "loopback"
    ? `loopback:${transport.base}`
    : `no_loopback:${transport.reason}`;
}

function runnerNameOf(transport: RunnerTransport): string | undefined {
  return transport.kind === "no_loopback" ? transport.runnerName : undefined;
}

export function setRunnerTransport(transport: RunnerTransport) {
  if (
    transportKey(transport) === transportKey(_runnerTransport) &&
    runnerNameOf(transport) === runnerNameOf(_runnerTransport)
  ) {
    return;
  }
  _runnerTransport = transport;
  _transportListeners.forEach((l) => l(transport));
}

export function getRunnerTransport(): RunnerTransport {
  return _runnerTransport;
}

/** The active loopback base, or null when the active runner has none from this browser. */
export function getRunnerApiBase(): string | null {
  return _runnerTransport.kind === "loopback" ? _runnerTransport.base : null;
}

/** Register a callback that fires when the runner transport changes. Returns an unsubscribe function. */
export function onRunnerTransportChange(
  listener: TransportChangeListener
): () => void {
  _transportListeners.add(listener);
  return () => {
    _transportListeners.delete(listener);
  };
}

/** Resolve once the transport is no longer `measuring`, or after `timeoutMs`. */
function waitForMeasuredTransport(timeoutMs: number): Promise<RunnerTransport> {
  const isMeasuring = (t: RunnerTransport) =>
    t.kind === "no_loopback" && t.reason === "measuring";
  if (!isMeasuring(_runnerTransport)) return Promise.resolve(_runnerTransport);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(_runnerTransport);
    };
    const unsubscribe = onRunnerTransportChange((t) => {
      if (!isMeasuring(t)) finish();
    });
    const timeoutId = setTimeout(finish, timeoutMs);
  });
}

function describeNoLoopback(
  transport: Extract<RunnerTransport, { kind: "no_loopback" }>
): string {
  const name = transport.runnerName
    ? `"${transport.runnerName}"`
    : "The selected runner";
  switch (transport.reason) {
    case "not_local":
      return `${name} is on another machine — its API is not reachable from this browser over loopback`;
    case "locality_unknown":
      return `${name} could not be confirmed to be on this machine, so its API is not called over loopback`;
    case "list_unavailable":
      return "The runner list could not be loaded, so no runner is called over loopback";
    case "measuring":
      return `${name} has not been confirmed to be on this machine yet`;
  }
}

// =============================================================================
// Fetch Wrapper
// =============================================================================

export class RunnerApiError extends Error {
  /**
   * The machine-readable error code: the runner's typed one, or — when no
   * request was made — RUNNER_NOT_LOCAL / RUNNER_LOCALITY_UNKNOWN (the active
   * runner has no loopback base from this browser) or
   * RUNNER_ORIGIN_UNREACHABLE (this page's origin cannot reach loopback).
   */
  readonly code?: string;
  /** Set when the runner's origin guard refused this page's origin. */
  readonly originRefusal?: RunnerOriginRefusal;
  /** Set when no request was made because the active runner is not proven local. */
  readonly noLoopbackReason?: RunnerNoLoopbackReason;

  constructor(
    public status: number,
    message: string,
    originRefusal?: RunnerOriginRefusal,
    refusal?: { noLoopbackReason?: RunnerNoLoopbackReason; code?: string }
  ) {
    super(message);
    this.name = "RunnerApiError";
    this.originRefusal = originRefusal;
    this.noLoopbackReason = refusal?.noLoopbackReason;
    this.code =
      originRefusal?.code ??
      refusal?.code ??
      (this.noLoopbackReason === undefined
        ? undefined
        : this.noLoopbackReason === "not_local"
          ? RUNNER_NOT_LOCAL
          : this.noLoopbackReason === "list_unavailable"
            ? RUNNER_LIST_UNAVAILABLE
            : RUNNER_LOCALITY_UNKNOWN);
  }
}

/**
 * True when a runner call was refused because the active runner was MEASURED
 * to be on another machine. An unproven locality or an origin that cannot
 * reach loopback is not that claim, so neither matches.
 */
export function isRunnerNotLocalError(error: unknown): boolean {
  return error instanceof RunnerApiError && error.code === RUNNER_NOT_LOCAL;
}

export interface RunnerFetchOptions extends RequestInit {
  timeoutMs?: number;
  /**
   * Fetch over THIS transport instead of the active one. The shared poll
   * registry pins each entry to the transport it was created for, so a poll
   * tick that fires after the active runner changed still fetches (and tags
   * its result with) the runner it belongs to.
   */
  transport?: RunnerLoopbackTransport;
}

export async function runnerFetch<T>(
  path: string,
  runnerOptions?: RunnerFetchOptions
): Promise<T> {
  const {
    transport: pinnedTransport,
    timeoutMs: requestedTimeoutMs,
    ...options
  } = runnerOptions ?? {};
  // Fast-fail without touching the network when the page origin can't
  // reach a loopback runner (see isLoopbackBase). Same error shape as a
  // connection failure, so callers' offline handling is unchanged —
  // minus the console noise.
  if (isRunnerUnreachableFromOrigin(pinnedTransport ?? _runnerTransport)) {
    throw new RunnerApiError(
      0,
      `Runner not reachable — loopback (${getRunnerApiBase() ?? RUNNER_API_BASE}) is only reachable from localhost dev origins`,
      undefined,
      { code: RUNNER_ORIGIN_UNREACHABLE }
    );
  }
  // The active runner is not proven to be on this machine: refuse rather
  // than fetch a loopback port some other local process may own.
  const transport =
    pinnedTransport ?? (await waitForMeasuredTransport(MEASURING_WAIT_MS));
  if (transport.kind === "no_loopback") {
    throw new RunnerApiError(0, describeNoLoopback(transport), undefined, {
      noLoopbackReason:
        transport.reason === "measuring"
          ? "locality_unknown"
          : transport.reason,
    });
  }
  const base = transport.base;
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timeoutMs = requestedTimeoutMs ?? 5000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RunnerApiError(
        0,
        `Runner request timed out after ${Math.round(timeoutMs / 1000)}s (${path})`
      );
    }
    if (error instanceof TypeError) {
      throw new RunnerApiError(
        0,
        `Runner not reachable — is qontinui-runner running at ${base}?`
      );
    }
    throw error;
  }

  if (!response.ok) {
    // A typed origin-guard refusal is not a broken runner — say what was
    // refused and how to admit it (see ./origin-refusal). Only a 403 can be
    // that refusal, so only a 403's body is read, and the abort timer stays
    // armed across the read: a runner that sends headers and then stalls the
    // body cannot hang the caller. An aborted read degrades to the generic
    // message below.
    let refusal: RunnerOriginRefusal | null = null;
    if (response.status === 403) {
      try {
        refusal = await readRunnerOriginRefusal(response);
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      clearTimeout(timeoutId);
    }
    if (refusal) {
      throw new RunnerApiError(
        response.status,
        describeRunnerOriginRefusal(refusal),
        refusal
      );
    }
    throw new RunnerApiError(
      response.status,
      `Runner API error: ${response.status} ${response.statusText}`
    );
  }
  clearTimeout(timeoutId);

  const text = await response.text();
  if (!text) return undefined as T;
  const json = JSON.parse(text);
  // Unwrap the ApiResponse envelope ({ success, data }) used by some endpoints.
  // This is the ONLY envelope unwrapped here: other endpoints that return a
  // named object — e.g. `/task-runs/running` -> { scope, task_runs } — are
  // handed back whole, and the caller declares that object as `T` and reads
  // its fields. Do not add per-endpoint unwrapping; a generic fetch helper
  // that guesses at payload shapes is how a shape change goes unnoticed.
  if (json && typeof json === "object" && "success" in json && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

// =============================================================================
// Shared Poll Registry — deduplicates concurrent polls to the same endpoint
// =============================================================================

type PollListener = (raw: unknown, err: Error | null) => void;

interface SharedPollEntry {
  /** The runner path this entry polls */
  path: string;
  /** The transport this entry polls over — fixed for the entry's lifetime */
  transport: RunnerLoopbackTransport;
  /** The setInterval ID (null when paused or no polling) */
  intervalId: NodeJS.Timeout | null;
  /** The active poll interval in ms (minimum of all subscriber intervals, 0 = no polling) */
  intervalMs: number;
  /** Callbacks to notify when new data arrives, mapped to their requested poll interval */
  listeners: Map<PollListener, number>;
  /** Latest cached result */
  lastResult: unknown;
  /** Latest error */
  lastError: Error | null;
  /** In-flight fetch promise (prevents overlapping requests) */
  pending: Promise<void> | null;
}

/**
 * Keyed by transport AND path: a result fetched from one runner must never be
 * served to a subscriber of another, including a response that lands after
 * the active runner changed.
 */
const _sharedPolls = new Map<string, SharedPollEntry>();

function sharedPollKey(activeTransportKey: string, path: string): string {
  return `${activeTransportKey}|${path}`;
}

/** Compute the fastest requested interval from all listeners (0 means no polling) */
function computeMinInterval(entry: SharedPollEntry): number {
  let min = 0;
  entry.listeners.forEach((requestedMs) => {
    if (requestedMs > 0) {
      min = min === 0 ? requestedMs : Math.min(min, requestedMs);
    }
  });
  return min;
}

function sharedFetch(entry: SharedPollEntry): Promise<void> {
  if (entry.pending) return entry.pending;
  entry.pending = runnerFetch<unknown>(entry.path, {
    transport: entry.transport,
  })
    .then((raw) => {
      entry.lastResult = raw;
      entry.lastError = null;
      entry.listeners.forEach((_interval, cb) => cb(raw, null));
    })
    .catch((err) => {
      entry.lastError = err instanceof Error ? err : new Error(String(err));
      entry.listeners.forEach((_interval, cb) => cb(null, entry.lastError));
    })
    .finally(() => {
      entry.pending = null;
    });
  return entry.pending;
}

function startSharedPolling(entry: SharedPollEntry) {
  stopSharedPolling(entry);
  if (entry.intervalMs > 0) {
    entry.intervalId = setInterval(() => sharedFetch(entry), entry.intervalMs);
  }
}

function stopSharedPolling(entry: SharedPollEntry) {
  if (entry.intervalId) {
    clearInterval(entry.intervalId);
    entry.intervalId = null;
  }
}

// Pause/resume all shared polls on visibility change
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      _sharedPolls.forEach((entry) => stopSharedPolling(entry));
    } else {
      _sharedPolls.forEach((entry) => {
        sharedFetch(entry);
        startSharedPolling(entry);
      });
    }
  });
}

// =============================================================================
// Generic Query Hook
// =============================================================================

export interface UseRunnerQueryOptions<T = unknown> {
  enabled?: boolean;
  pollInterval?: number;
  /** Transform the raw API response before storing (e.g. unwrap nested fields) */
  transform?: (raw: unknown) => T;
}

export interface UseRunnerQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  refetch: () => Promise<void>;
}

export function useRunnerQuery<T>(
  path: string | null,
  options?: UseRunnerQueryOptions<T>
): UseRunnerQueryResult<T> {
  // Data is stored with the transport it was fetched over and rendered only
  // while that transport is still the active one: a previous runner's
  // (possibly wrong-box) answer is never shown as the new runner's, not even
  // for the one render before an effect could clear it.
  const [dataEntry, setDataEntry] = useState<{
    transportKey: string;
    value: T;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const enabled = options?.enabled !== false;
  const pollInterval = options?.pollInterval ?? 0;
  const transformRef = useRef(options?.transform);
  transformRef.current = options?.transform;

  // Re-evaluate the gates if the active runner transport changes at runtime
  // (multi-runner switcher, or its locality probe answering) without a
  // remount. A changed base re-subscribes, so the new runner is fetched.
  const [transport, setTransport] = useState(getRunnerTransport);
  useEffect(() => onRunnerTransportChange(setTransport), []);
  const unreachableFromOrigin = isRunnerUnreachableFromOrigin(transport);
  const activeTransportKey = transportKey(transport);

  // Shared-poll key: transport + path. Multiple hooks with the same key but
  // different intervals get the fastest interval.
  const pollKey =
    path === null ? null : sharedPollKey(activeTransportKey, path);
  const data =
    dataEntry !== null && dataEntry.transportKey === activeTransportKey
      ? dataEntry.value
      : null;

  const applyResult = useCallback(
    (fetchedOver: string, raw: unknown, err: Error | null) => {
      if (err) {
        if (err instanceof TypeError && err.message.includes("fetch")) {
          setIsOffline(true);
          setError("Runner not connected");
        } else if (err instanceof RunnerApiError) {
          setError(err.message);
          setIsOffline(false);
        } else {
          setIsOffline(true);
          setError("Runner not connected");
        }
      } else {
        const result = transformRef.current
          ? transformRef.current(raw)
          : (raw as T);
        setDataEntry({ transportKey: fetchedOver, value: result });
        setError(null);
        setIsOffline(false);
      }
      setIsLoading(false);
    },
    []
  );

  useEffect(() => {
    if (!enabled || !path || !pollKey) {
      setIsLoading(false);
      return;
    }

    // Loopback runner + non-localhost page origin: the fetch can never
    // succeed (Chrome blocks public→loopback), so don't start poll timers
    // at all — report offline immediately, exactly as a failed fetch would.
    if (unreachableFromOrigin) {
      setIsOffline(true);
      setError("Runner not connected");
      setIsLoading(false);
      return;
    }

    // No loopback base for the active runner: never fetch. While its
    // locality probe is in flight stay loading; once it has answered
    // "not on this machine" (or could not prove it is), report offline
    // with the reason.
    if (transport.kind === "no_loopback") {
      if (transport.reason === "measuring") {
        setIsLoading(true);
        setError(null);
        setIsOffline(false);
      } else {
        setIsOffline(true);
        setError(describeNoLoopback(transport));
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);

    // One listener per subscription, tagged with the transport its results
    // were fetched over.
    const listener: PollListener = (raw, err) =>
      applyResult(activeTransportKey, raw, err);

    let entry = _sharedPolls.get(pollKey);
    if (entry) {
      // Join existing shared poll — track this listener's requested interval
      entry.listeners.set(listener, pollInterval);
      const newMin = computeMinInterval(entry);
      if (newMin !== entry.intervalMs) {
        entry.intervalMs = newMin;
        if (newMin > 0) {
          startSharedPolling(entry);
        } else {
          stopSharedPolling(entry);
        }
      }
      // Serve cached data immediately if available
      if (entry.lastResult !== undefined) {
        listener(entry.lastResult, null);
      } else if (entry.lastError) {
        listener(null, entry.lastError);
      } else {
        // A fetch is likely already in-flight from the first subscriber
        sharedFetch(entry);
      }
    } else {
      // Create new shared poll entry
      entry = {
        path,
        transport,
        intervalId: null,
        intervalMs: pollInterval,
        listeners: new Map([[listener, pollInterval]]),
        lastResult: undefined,
        lastError: null,
        pending: null,
      };
      _sharedPolls.set(pollKey, entry);
      sharedFetch(entry);
      startSharedPolling(entry);
    }

    return () => {
      const e = _sharedPolls.get(pollKey);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) {
        stopSharedPolling(e);
        _sharedPolls.delete(pollKey);
      } else {
        // Recalculate interval — a fast poller may have just left
        const newMin = computeMinInterval(e);
        if (newMin !== e.intervalMs) {
          e.intervalMs = newMin;
          if (newMin > 0) {
            startSharedPolling(e);
          } else {
            stopSharedPolling(e);
          }
        }
      }
    };
    // `transport` is read only through `activeTransportKey` (part of
    // `pollKey`), which changes exactly when the fields read above do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pollKey,
    pollInterval,
    enabled,
    applyResult,
    path,
    unreachableFromOrigin,
    activeTransportKey,
  ]);

  const refetch = useCallback(async () => {
    if (!pollKey) return;
    const entry = _sharedPolls.get(pollKey);
    if (entry) {
      await sharedFetch(entry);
    }
  }, [pollKey]);

  return { data, isLoading, error, isOffline, refetch };
}

// =============================================================================
// Mutation Hook
// =============================================================================

export interface UseRunnerMutationResult<TInput, TOutput> {
  mutate: (input: TInput) => Promise<TOutput>;
  isLoading: boolean;
  error: string | null;
}

export function useRunnerMutation<TInput, TOutput>(
  path: string,
  method: string = "POST"
): UseRunnerMutationResult<TInput, TOutput> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await runnerFetch<TOutput>(path, {
          method,
          body: JSON.stringify(input),
        });
        return result;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Runner mutation failed";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [path, method]
  );

  return { mutate, isLoading, error };
}
