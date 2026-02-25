"use client";

import { useRunnerQuery, useRunnerMutation } from "../api-client";
import type {
  ExplorationReport,
  ExplorationStrategy,
} from "../types/exploration";

export function useExplorationHistory(limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return useRunnerQuery<ExplorationReport[]>(`/state-explorer/history${qs}`);
}

export function useExplorationStrategies() {
  return useRunnerQuery<ExplorationStrategy[]>("/state-explorer/strategies");
}

export function useExplorationStatus(jobId: string | null) {
  return useRunnerQuery<{
    status: "running" | "complete" | "error" | "stopped";
    phase?: string;
    elements_discovered?: number;
    pages_visited?: number;
    current_url?: string;
    error?: string;
    progress_pct?: number;
  }>(jobId ? `/ui-bridge/explore/status?job_id=${jobId}` : null, {
    pollInterval: 1000,
    enabled: jobId != null,
  });
}

export function useExplorationResults(jobId: string | null, enabled: boolean) {
  return useRunnerQuery<{
    state_discovery_result?: unknown;
    elements_discovered?: number;
    pages_visited?: number;
    duration_seconds?: number;
  }>(jobId ? `/ui-bridge/explore/results?job_id=${jobId}` : null, {
    enabled,
  });
}

export function useStartExploration() {
  return useRunnerMutation<
    {
      target_type?: "web";
      connection_url: string;
      max_depth?: number;
      max_elements_per_page?: number;
      max_total_elements?: number;
      action_delay_ms?: number;
      blocked_keywords?: string[];
      safe_keywords?: string[];
      blocked_selectors?: string[];
      capture_screenshots?: boolean;
      run_state_discovery?: boolean;
    },
    { job_id: string }
  >("/ui-bridge/explore");
}

export function useStopExploration() {
  return useRunnerMutation<Record<string, never>, void>(
    "/ui-bridge/explore/stop"
  );
}

export function useDiscoverStatesFromRenders() {
  return useRunnerMutation<{ render_logs: unknown[] }, unknown>(
    "/ui-bridge/discover-states"
  );
}
