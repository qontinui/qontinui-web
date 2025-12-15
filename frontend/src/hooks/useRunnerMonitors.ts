"use client";

import { useQuery } from "@tanstack/react-query";
import { runnerClient, type RunnerMonitor } from "@/lib/runner-client";

/**
 * Default monitor information when runner is not available
 * Used as fallback to allow UI to function without runner connection
 */
const DEFAULT_MONITORS: RunnerMonitor[] = [
  {
    index: 0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    is_primary: true,
    position: "primary",
    name: "Monitor 0",
    description: "Monitor 0 (primary, 1920x1080)",
  },
];

/**
 * Query keys for runner monitor queries
 */
export const runnerMonitorKeys = {
  all: ["runner-monitors"] as const,
  monitors: () => [...runnerMonitorKeys.all, "list"] as const,
  availability: () => [...runnerMonitorKeys.all, "available"] as const,
};

/**
 * Hook to fetch monitors from the runner
 *
 * Returns real monitor information when runner is connected,
 * falls back to defaults when runner is not available.
 *
 * @param options.enabled - Whether to enable the query (default: true)
 * @param options.refetchInterval - How often to refetch (default: 30000ms)
 * @param options.staleTime - How long data is considered fresh (default: 10000ms)
 */
export function useRunnerMonitors(options?: {
  enabled?: boolean;
  refetchInterval?: number;
  staleTime?: number;
}) {
  const {
    enabled = true,
    refetchInterval = 30000, // Refetch every 30 seconds
    staleTime = 10000, // Consider data fresh for 10 seconds
  } = options || {};

  const query = useQuery({
    queryKey: runnerMonitorKeys.monitors(),
    queryFn: async () => {
      try {
        const response = await runnerClient.getMonitors();
        return response.data;
      } catch (error) {
        // Silently fail - runner might be offline
        console.debug("[useRunnerMonitors] Failed to fetch monitors:", error);
        return null;
      }
    },
    enabled,
    refetchInterval,
    staleTime,
    retry: 1, // Only retry once - runner might be offline
    retryDelay: 1000,
    // Never throw errors to the UI - always use fallback data
    throwOnError: false,
  });

  // Derive monitors with fallback
  const monitors = query.data?.monitors ?? DEFAULT_MONITORS;
  // Connected only if we have actual data (not null from error catch)
  const isRunnerConnected =
    query.isSuccess && query.data !== null && !query.isError;
  const availableDescriptors = query.data?.available_descriptors ?? [
    "primary",
    "0",
  ];

  return {
    // Query state
    ...query,
    // Derived data with fallbacks
    monitors,
    monitorCount: monitors.length,
    isRunnerConnected,
    availableDescriptors,
    // Helper to get a monitor by index
    getMonitor: (index: number) => monitors.find((m) => m.index === index),
    // Helper to get monitor label
    getMonitorLabel: (index: number) => {
      const monitor = monitors.find((m) => m.index === index);
      if (monitor) {
        // Use position for label, capitalize first letter
        const position = monitor.position;
        return position.charAt(0).toUpperCase() + position.slice(1);
      }
      return `Monitor ${index}`;
    },
    // Helper to get full monitor description
    getMonitorDescription: (index: number) => {
      const monitor = monitors.find((m) => m.index === index);
      return monitor?.description ?? `Monitor ${index}`;
    },
  };
}

/**
 * Hook to check if runner is available
 */
export function useRunnerAvailability(options?: {
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const { enabled = true, refetchInterval = 10000 } = options || {};

  return useQuery({
    queryKey: runnerMonitorKeys.availability(),
    queryFn: () => runnerClient.isAvailable(),
    enabled,
    refetchInterval,
    staleTime: 5000,
    retry: false,
  });
}
