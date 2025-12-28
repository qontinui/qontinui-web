"use client";

/**
 * useTreeEvents Hook
 *
 * Fetches tree events and execution tree data from the backend API.
 * Used for displaying historical execution data on the web frontend.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiClient } from "@/lib/api-client";

// API response types (inline to avoid circular dependencies)
interface ApiTreeEventResponse {
  id: string;
  run_id: string;
  event_type: string;
  node_id: string;
  node_type: string;
  node_name: string;
  parent_node_id: string | null;
  path: Array<{ id: string; name: string; node_type: string }>;
  sequence: number;
  event_timestamp: number;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ApiDisplayNode {
  id: string;
  node_type: string;
  name: string;
  timestamp: number;
  end_timestamp?: number | null;
  duration?: number | null;
  status: string;
  metadata: Record<string, unknown>;
  error?: string | null;
  children: unknown[];
  is_expanded: boolean;
  level: number;
}

interface ApiExecutionTreeResponse {
  run_id: string;
  root_nodes: ApiDisplayNode[];
  total_events: number;
  workflow_name: string | null;
  status: string;
  duration_ms: number | null;
  initial_state_ids: string[];
}

interface UseTreeEventsOptions {
  /** Execution run ID to fetch events for */
  runId: string | null;
  /** Whether to auto-fetch on mount */
  autoFetch?: boolean;
  /** Polling interval in ms (0 = no polling) */
  pollingInterval?: number;
}

interface UseTreeEventsReturn {
  /** Raw tree events from API */
  events: ApiTreeEventResponse[];
  /** Reconstructed execution tree */
  tree: ApiExecutionTreeResponse | null;
  /** Root display nodes from tree */
  rootNodes: ApiDisplayNode[];
  /** Whether currently loading */
  isLoading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Total number of events */
  totalEvents: number;
  /** Workflow name */
  workflowName: string | null;
  /** Overall execution status */
  status: string | null;
  /** Total duration in ms */
  durationMs: number | null;
  /** Initial state IDs from workflow metadata */
  initialStateIds: string[];
  /** Manually refresh data */
  refresh: () => Promise<void>;
  /** Fetch more events (pagination) */
  fetchMore: (offset: number, limit?: number) => Promise<void>;
  /** Clear all data */
  clear: () => void;
}

/**
 * Hook for fetching and managing tree events data
 */
export function useTreeEvents({
  runId,
  autoFetch = true,
  pollingInterval = 0,
}: UseTreeEventsOptions): UseTreeEventsReturn {
  const [events, setEvents] = useState<ApiTreeEventResponse[]>([]);
  const [tree, setTree] = useState<ApiExecutionTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch execution tree (reconstructed tree structure)
  const fetchTree = useCallback(async () => {
    if (!runId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.getExecutionTree(runId);
      setTree(response);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to fetch execution tree")
      );
      console.error("[useTreeEvents] Error fetching tree:", err);
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  // Fetch raw events (flat list)
  const fetchEvents = useCallback(
    async (offset = 0, limit = 500) => {
      if (!runId) return;

      setIsLoading(true);
      setError(null);

      try {
        const response = await apiClient.listTreeEvents(runId, {
          offset,
          limit,
        });
        if (offset === 0) {
          setEvents(response.events);
        } else {
          setEvents((prev) => [...prev, ...response.events]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("Failed to fetch tree events")
        );
        console.error("[useTreeEvents] Error fetching events:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [runId]
  );

  // Refresh all data
  const refresh = useCallback(async () => {
    await Promise.all([fetchTree(), fetchEvents(0)]);
  }, [fetchTree, fetchEvents]);

  // Fetch more events (pagination)
  const fetchMore = useCallback(
    async (offset: number, limit = 500) => {
      await fetchEvents(offset, limit);
    },
    [fetchEvents]
  );

  // Clear all data
  const clear = useCallback(() => {
    setEvents([]);
    setTree(null);
    setError(null);
  }, []);

  // Auto-fetch on mount and when runId changes
  useEffect(() => {
    if (autoFetch && runId) {
      refresh();
    }
  }, [autoFetch, runId, refresh]);

  // Polling
  useEffect(() => {
    if (!pollingInterval || !runId) return;

    const interval = setInterval(() => {
      refresh();
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [pollingInterval, runId, refresh]);

  // Derived values
  const rootNodes = useMemo(() => tree?.root_nodes ?? [], [tree]);
  const totalEvents = useMemo(
    () => tree?.total_events ?? events.length,
    [tree, events]
  );
  const workflowName = useMemo(() => tree?.workflow_name ?? null, [tree]);
  const status = useMemo(() => tree?.status ?? null, [tree]);
  const durationMs = useMemo(() => tree?.duration_ms ?? null, [tree]);
  const initialStateIds = useMemo(() => tree?.initial_state_ids ?? [], [tree]);

  return {
    events,
    tree,
    rootNodes,
    isLoading,
    error,
    totalEvents,
    workflowName,
    status,
    durationMs,
    initialStateIds,
    refresh,
    fetchMore,
    clear,
  };
}

/**
 * Hook for fetching tree events for the current active run
 * Combines with WebSocket for live updates
 */
export function useLiveTreeEvents(runId: string | null) {
  const treeEvents = useTreeEvents({
    runId,
    autoFetch: true,
    pollingInterval: 5000, // Poll every 5 seconds for updates
  });

  return treeEvents;
}

export default useTreeEvents;
