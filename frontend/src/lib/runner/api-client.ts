"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { isRunnerReachable } from "@/lib/ui-bridge/discovered-specs";

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

/** True when fetching the current runner base from this page can never succeed. */
function isRunnerUnreachableFromOrigin(): boolean {
  return isLoopbackBase(_runnerApiBase) && !isRunnerReachable();
}
export const DEFAULT_POLL_INTERVAL = 5000;
export const HEALTH_POLL_INTERVAL = 10000;

// Mutable base URL for multi-runner support.
// Defaults to RUNNER_API_BASE but can be changed at runtime
// when the user selects a different runner instance.
let _runnerApiBase = RUNNER_API_BASE;

type BaseUrlChangeListener = (newBase: string) => void;
const _baseUrlListeners = new Set<BaseUrlChangeListener>();

export function setRunnerApiBase(url: string) {
  if (url === _runnerApiBase) return;
  _runnerApiBase = url;
  _baseUrlListeners.forEach((l) => l(url));
}

export function getRunnerApiBase(): string {
  return _runnerApiBase;
}

/** Register a callback that fires when the runner API base URL changes. Returns an unsubscribe function. */
export function onRunnerApiBaseChange(
  listener: BaseUrlChangeListener
): () => void {
  _baseUrlListeners.add(listener);
  return () => {
    _baseUrlListeners.delete(listener);
  };
}

// =============================================================================
// Fetch Wrapper
// =============================================================================

export class RunnerApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "RunnerApiError";
  }
}

export async function runnerFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  // Fast-fail without touching the network when the page origin can't
  // reach a loopback runner (see isLoopbackBase). Same error shape as a
  // connection failure, so callers' offline handling is unchanged —
  // minus the console noise.
  if (isRunnerUnreachableFromOrigin()) {
    throw new RunnerApiError(
      0,
      `Runner not reachable — loopback (${_runnerApiBase}) is only reachable from localhost dev origins`
    );
  }
  const url = `${_runnerApiBase}${path}`;
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 5000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
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
        `Runner not reachable — is qontinui-runner running at ${_runnerApiBase}?`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new RunnerApiError(
      response.status,
      `Runner API error: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  const json = JSON.parse(text);
  // Unwrap ApiResponse envelope ({ success, data }) used by some endpoints
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

const _sharedPolls = new Map<string, SharedPollEntry>();

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

function sharedFetch(path: string, entry: SharedPollEntry): Promise<void> {
  if (entry.pending) return entry.pending;
  entry.pending = runnerFetch<unknown>(path)
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

function startSharedPolling(path: string, entry: SharedPollEntry) {
  stopSharedPolling(entry);
  if (entry.intervalMs > 0) {
    entry.intervalId = setInterval(
      () => sharedFetch(path, entry),
      entry.intervalMs
    );
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
      _sharedPolls.forEach((entry, path) => {
        sharedFetch(path, entry);
        startSharedPolling(path, entry);
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
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const enabled = options?.enabled !== false;
  const pollInterval = options?.pollInterval ?? 0;
  const transformRef = useRef(options?.transform);
  transformRef.current = options?.transform;

  // Re-evaluate the loopback gate if the active runner base changes at
  // runtime (multi-runner switcher) — a future non-loopback base must
  // lift the gate without a remount.
  const [apiBase, setApiBase] = useState(getRunnerApiBase);
  useEffect(() => onRunnerApiBaseChange(setApiBase), []);
  const unreachableFromOrigin =
    isLoopbackBase(apiBase) && !isRunnerReachable();

  // Build a stable cache key from path + poll interval.
  // Multiple hooks with the same path but different intervals get the fastest interval.
  const cacheKey = path ?? "";

  const applyResult = useCallback((raw: unknown, err: Error | null) => {
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
      setData(result);
      setError(null);
      setIsOffline(false);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled || !path) {
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

    setIsLoading(true);

    let entry = _sharedPolls.get(path);
    if (entry) {
      // Join existing shared poll — track this listener's requested interval
      entry.listeners.set(applyResult, pollInterval);
      const newMin = computeMinInterval(entry);
      if (newMin !== entry.intervalMs) {
        entry.intervalMs = newMin;
        if (newMin > 0) {
          startSharedPolling(path, entry);
        } else {
          stopSharedPolling(entry);
        }
      }
      // Serve cached data immediately if available
      if (entry.lastResult !== undefined) {
        applyResult(entry.lastResult, null);
      } else if (entry.lastError) {
        applyResult(null, entry.lastError);
      } else {
        // A fetch is likely already in-flight from the first subscriber
        sharedFetch(path, entry);
      }
    } else {
      // Create new shared poll entry
      entry = {
        intervalId: null,
        intervalMs: pollInterval,
        listeners: new Map([[applyResult, pollInterval]]),
        lastResult: undefined,
        lastError: null,
        pending: null,
      };
      _sharedPolls.set(path, entry);
      sharedFetch(path, entry);
      startSharedPolling(path, entry);
    }

    return () => {
      const e = _sharedPolls.get(path);
      if (!e) return;
      e.listeners.delete(applyResult);
      if (e.listeners.size === 0) {
        stopSharedPolling(e);
        _sharedPolls.delete(path);
      } else {
        // Recalculate interval — a fast poller may have just left
        const newMin = computeMinInterval(e);
        if (newMin !== e.intervalMs) {
          e.intervalMs = newMin;
          if (newMin > 0) {
            startSharedPolling(path, e);
          } else {
            stopSharedPolling(e);
          }
        }
      }
    };
  }, [cacheKey, pollInterval, enabled, applyResult, path, unreachableFromOrigin]);

  const refetch = useCallback(async () => {
    if (!path) return;
    const entry = _sharedPolls.get(path);
    if (entry) {
      await sharedFetch(path, entry);
    }
  }, [path]);

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
