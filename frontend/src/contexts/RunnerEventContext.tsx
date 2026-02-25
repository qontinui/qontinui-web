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
} from "@/hooks/useRunnerEventStream";
import { runnerFetch, RunnerApiError } from "@/lib/runner-api";

// =============================================================================
// Context
// =============================================================================

interface RunnerEventContextValue {
  subscribe: (channel: string, callback: EventCallback) => () => void;
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
  const { subscribe } = useRunnerEventStream(enabled);

  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return (
    <RunnerEventCtx.Provider value={value}>{children}</RunnerEventCtx.Provider>
  );
}

// =============================================================================
// useRunnerEvent - subscribe to a specific channel
// =============================================================================

export function useRunnerEvent(channel: string, callback: EventCallback) {
  const ctx = useContext(RunnerEventCtx);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx) return;

    const handler: EventCallback = (data) => {
      callbackRef.current(data);
    };

    return ctx.subscribe(channel, handler);
  }, [ctx, channel]);
}

// =============================================================================
// useEventTriggeredFetch - drop-in replacement for useRunnerQuery polling hooks
// =============================================================================

/** Default fallback polling interval when no WS events arrive */
const FALLBACK_POLL_MS = 5000;

interface UseEventTriggeredFetchOptions<T> {
  enabled?: boolean;
  transform?: (raw: unknown) => T;
  /** Debounce delay in ms before refetching on event (default 200) */
  debounceMs?: number;
  /** Fallback polling interval in ms when WS events don't arrive (default 5000, 0 to disable) */
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
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const enabled = options?.enabled !== false;
  const transform = options?.transform;
  const debounceMs = options?.debounceMs ?? 200;
  const fallbackPollMs = options?.fallbackPollMs ?? FALLBACK_POLL_MS;

  const transformRef = useRef(transform);
  transformRef.current = transform;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!path || !enabled) return;
    try {
      const raw = await runnerFetch<unknown>(path);
      if (!mountedRef.current) return;
      const result = transformRef.current
        ? transformRef.current(raw)
        : (raw as T);
      setData(result);
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
      } else {
        setIsOffline(true);
        setError("Runner not connected");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [path, enabled]);

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

    const startPolling = () => {
      if (fallbackIntervalRef.current)
        clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = setInterval(fetchData, fallbackPollMs);
    };

    const stopPolling = () => {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
    };

    startPolling();

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchData(); // Refresh immediately on tab return
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData, enabled, path, fallbackPollMs]);

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
      const unsub = ctx.subscribe(ch, () => {
        // Debounce rapid events
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          fetchData();
          // Reset fallback poll timer so we don't double-fetch
          if (fallbackIntervalRef.current && fallbackPollMs) {
            clearInterval(fallbackIntervalRef.current);
            fallbackIntervalRef.current = setInterval(
              fetchData,
              fallbackPollMs
            );
          }
        }, debounceMs);
      });
      unsubscribers.push(unsub);
    }

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [ctx, channels, enabled, path, fetchData, debounceMs, fallbackPollMs]);

  return { data, isLoading, error, isOffline, refetch: fetchData };
}
