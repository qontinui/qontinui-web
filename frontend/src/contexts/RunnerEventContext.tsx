"use client";

import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  useRunnerEventStream,
  type EventCallback,
  type RunnerEventStreamState,
} from "@/hooks/useRunnerEventStream";
import {
  isRunnerNeedsLocalError,
  runnerFetch,
  RunnerApiError,
  startRunnerPoll,
  type RunnerPollTickResult,
} from "@/lib/runner/api-client";
import { useRunnerTarget } from "@/contexts/active-runner-context";
import { targetKey } from "@/lib/runner/target";

// =============================================================================
// Context
// =============================================================================

interface RunnerEventContextValue {
  subscribe: (
    channel: string,
    callback: EventCallback,
    subscriberId?: string
  ) => () => void;
  /**
   * `unavailable` when no socket can exist for the active runner (it is
   * reached over the relay, or not resolved): subscribers receive nothing,
   * which is UNKNOWN — never "no events".
   */
  state: RunnerEventStreamState;
}

const RunnerEventCtx = createContext<RunnerEventContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface RunnerEventProviderProps {
  enabled?: boolean;
  children: React.ReactNode;
}

export function RunnerEventProvider({
  enabled = true,
  children,
}: RunnerEventProviderProps) {
  const target = useRunnerTarget();
  const { subscribe, state } = useRunnerEventStream(target, enabled);

  const value = useMemo(() => ({ subscribe, state }), [subscribe, state]);

  return (
    <RunnerEventCtx.Provider value={value}>{children}</RunnerEventCtx.Provider>
  );
}

/**
 * Whether runner events can arrive at all. `unavailable` outside a provider
 * too. A consumer that renders "live" status from events must show UNKNOWN
 * (or its polled value) when this is not `live`.
 */
export function useRunnerEventStreamState(): RunnerEventStreamState {
  return useContext(RunnerEventCtx)?.state ?? "unavailable";
}

// =============================================================================
// useRunnerEvent - subscribe to a specific channel
// =============================================================================

export function useRunnerEvent(channel: string, callback: EventCallback) {
  const ctx = useContext(RunnerEventCtx);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  // Stable ID per hook instance — survives HMR re-renders so re-subscribe replaces instead of accumulating
  const idRef = useRef(
    `evt-${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    if (!ctx) return;

    const handler: EventCallback = (data) => {
      callbackRef.current(data);
    };

    return ctx.subscribe(channel, handler, idRef.current);
  }, [ctx, channel]);
}

// =============================================================================
// useEventTriggeredFetch - drop-in replacement for useRunnerQuery polling hooks
// =============================================================================

/** Default fallback polling interval when no WS events arrive */
const FALLBACK_POLL_MS = 30000;

interface UseEventTriggeredFetchOptions<T> {
  enabled?: boolean;
  transform?: (raw: unknown) => T;
  /** Debounce delay in ms before refetching on event (default 200) */
  debounceMs?: number;
  /**
   * Fallback polling interval in ms when WS events don't arrive (default
   * 30000, 0 to disable). When the event stream is unavailable (a relayed
   * runner) this poll is the ONLY source of updates, so it runs even when 0
   * was asked for (at the default interval). Its cadence goes through
   * runnerPollInterval on every tick — never faster than the relay cadence
   * for a relayed or unresolved target — and it stops once the runner
   * refused the path over the relay (RUNNER_NEEDS_LOCAL, shown as `error`).
   */
  fallbackPollMs?: number;
}

interface UseEventTriggeredFetchResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  refetch: () => Promise<void>;
}

export function useEventTriggeredFetch<T>(
  channel: string | string[],
  path: string | null,
  options?: UseEventTriggeredFetchOptions<T>
): UseEventTriggeredFetchResult<T> {
  const ctx = useContext(RunnerEventCtx);
  const target = useRunnerTarget();
  const streamLive = ctx?.state === "live";
  // Data is tagged with the target+route it was fetched from and shown only
  // while that is still the active one — another runner's answer is never
  // rendered as this one's.
  const activeKey = targetKey(target);
  const [dataEntry, setDataEntry] = useState<{ key: string; value: T } | null>(
    null
  );
  const data =
    dataEntry !== null && dataEntry.key === activeKey ? dataEntry.value : null;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const enabled = options?.enabled !== false;
  const transform = options?.transform;
  const debounceMs = options?.debounceMs ?? 200;
  const requestedFallbackPollMs = options?.fallbackPollMs ?? FALLBACK_POLL_MS;
  // The REQUESTED fallback cadence; startRunnerPoll applies the relay floor.
  const fallbackPollMs =
    streamLive || requestedFallbackPollMs > 0
      ? requestedFallbackPollMs
      : FALLBACK_POLL_MS;

  const transformRef = useRef(transform);
  transformRef.current = transform;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Restarts the running fallback poll (so an event-triggered fetch resets
  // its timer); null while no fallback poll runs.
  const restartFallbackPollRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  // Stable ID per hook instance — prevents HMR subscriber accumulation
  const subIdRef = useRef(
    `etf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Returns "stop" when the runner refused the path over the relay: asking
  // again cannot change that, so a poll driving this stops.
  const fetchData = useCallback(async (): Promise<RunnerPollTickResult> => {
    if (!path || !enabled) return;
    const fetchedKey = targetKey(target);
    try {
      const raw = await runnerFetch<unknown>(target, path);
      if (!mountedRef.current) return;
      const result = transformRef.current
        ? transformRef.current(raw)
        : (raw as T);
      setDataEntry({ key: fetchedKey, value: result });
      setError(null);
      setIsOffline(false);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setIsOffline(true);
        setError("Runner not connected");
      } else if (err instanceof RunnerApiError) {
        setError(err.message);
        setIsOffline(false);
        if (isRunnerNeedsLocalError(err)) return "stop";
      } else {
        setIsOffline(true);
        setError("Runner not connected");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [target, path, enabled]);

  // Initial fetch on mount
  useEffect(() => {
    if (!enabled || !path) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchData();
  }, [fetchData, enabled, path]);

  // Fallback polling + visibility pause/resume
  useEffect(() => {
    if (!enabled || !path || !fallbackPollMs) return;

    let stop: (() => void) | null = null;
    let refused = false;

    const stopPolling = () => {
      stop?.();
      stop = null;
    };

    const startPolling = () => {
      stopPolling();
      if (refused) return;
      stop = startRunnerPoll({
        getTarget: () => target,
        requestedMs: fallbackPollMs,
        tick: async () => {
          const result = await fetchData();
          if (result === "stop") refused = true;
          return result;
        },
      });
    };

    startPolling();
    restartFallbackPollRef.current = () => {
      if (stop) startPolling();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else if (!refused) {
        void fetchData().then((result) => {
          if (result === "stop") {
            refused = true;
            stopPolling();
          }
        }); // Refresh immediately on tab return
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      restartFallbackPollRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData, enabled, path, fallbackPollMs, target]);

  // Subscribe to channel(s) for event-triggered refetch (faster than polling)
  const channels = useMemo(
    () => (Array.isArray(channel) ? channel : [channel]),
    // For array channels, serialize to avoid new refs each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(channel) ? channel.join(",") : channel]
  );

  useEffect(() => {
    if (!ctx || !enabled || !path) return;

    const unsubscribers: Array<() => void> = [];

    for (const ch of channels) {
      const unsub = ctx.subscribe(
        ch,
        () => {
          // Debounce rapid events
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            fetchData();
            // Reset fallback poll timer so we don't double-fetch
            restartFallbackPollRef.current?.();
          }, debounceMs);
        },
        `${subIdRef.current}-${ch}`
      );
      unsubscribers.push(unsub);
    }

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [ctx, channels, enabled, path, fetchData, debounceMs]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return { data, isLoading, error, isOffline, refetch };
}
