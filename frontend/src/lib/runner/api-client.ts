"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// =============================================================================
// Configuration
// =============================================================================

export const RUNNER_API_BASE = "http://localhost:9876";
export const DEFAULT_POLL_INTERVAL = 5000;
export const HEALTH_POLL_INTERVAL = 10000;

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
  const url = `${RUNNER_API_BASE}${path}`;
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const enabled = options?.enabled !== false;
  const pollInterval = options?.pollInterval;
  const transformRef = useRef(options?.transform);
  transformRef.current = options?.transform;

  const fetchData = useCallback(async () => {
    if (!path || !enabled) return;
    try {
      const raw = await runnerFetch<unknown>(path);
      const result = transformRef.current ? transformRef.current(raw) : (raw as T);
      setData(result);
      setError(null);
      setIsOffline(false);
    } catch (err) {
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
      setIsLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    if (!enabled || !path) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchData();

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (pollInterval) {
        intervalRef.current = setInterval(fetchData, pollInterval);
      }
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    startPolling();

    // Pause polling when tab is hidden to prevent request accumulation
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchData(); // Refresh immediately on return
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData, pollInterval, enabled, path]);

  return { data, isLoading, error, isOffline, refetch: fetchData };
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
