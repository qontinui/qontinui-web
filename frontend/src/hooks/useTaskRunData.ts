"use client";

/**
 * Dual-source hooks for task run data.
 *
 * These hooks fetch from the web backend (PostgreSQL) as the primary source,
 * and optionally merge live runner data when the runner is connected.
 * This allows pages to work even when the runner is offline.
 */

import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import { useTaskRuns as useRunnerTaskRuns } from "@/lib/runner/hooks/task-run-hooks";
import { useFindingsSummary as useRunnerFindingsSummary } from "@/lib/runner/hooks/task-run-hooks";
import type {
  BackendTaskRunListResponse,
  BackendTaskRunResponse,
  BackendFindingsSummaryResponse,
  TaskRunView,
  FindingsSummaryView,
} from "@/lib/task-run-mappers";
import {
  mapBackendTaskRun,
  mapRunnerTaskRun,
  mapBackendFinding,
  mergeTaskRunSources,
} from "@/lib/task-run-mappers";

// =============================================================================
// Query Keys
// =============================================================================

export const taskRunDataKeys = {
  all: ["task-run-data"] as const,
  lists: () => [...taskRunDataKeys.all, "list"] as const,
  list: (params?: { limit?: number; status?: string; task_type?: string }) =>
    [...taskRunDataKeys.lists(), params] as const,
  details: () => [...taskRunDataKeys.all, "detail"] as const,
  detail: (id: string) => [...taskRunDataKeys.details(), id] as const,
  findingsSummary: () => [...taskRunDataKeys.all, "findings-summary"] as const,
};

// =============================================================================
// Backend Fetchers
// =============================================================================

async function fetchBackendTaskRuns(params?: {
  limit?: number;
  status?: string;
  task_type?: string;
}): Promise<BackendTaskRunListResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.status) query.set("status", params.status);
  if (params?.task_type) query.set("task_type", params.task_type);
  const qs = query.toString();
  return httpClient.get<BackendTaskRunListResponse>(
    `/api/v1/task-runs${qs ? `?${qs}` : ""}`
  );
}

async function fetchBackendTaskRunDetail(
  id: string
): Promise<BackendTaskRunResponse> {
  return httpClient.get<BackendTaskRunResponse>(`/api/v1/task-runs/${id}`);
}

async function fetchBackendFindingsSummary(): Promise<BackendFindingsSummaryResponse> {
  return httpClient.get<BackendFindingsSummaryResponse>(
    "/api/v1/task-runs/findings-summary"
  );
}

// =============================================================================
// Dual-Source Hooks
// =============================================================================

interface UseTaskRunListOptions {
  limit?: number;
  status?: string;
  task_type?: string;
}

interface UseTaskRunListResult {
  data: TaskRunView[];
  isLoading: boolean;
  error: Error | null;
  isBackendError: boolean;
  isRunnerOffline: boolean;
  refetch: () => void;
}

/**
 * Fetches task runs from the backend (primary) and merges with runner (live).
 * Works even when the runner is offline — shows historical data from PostgreSQL.
 */
export function useTaskRunList(
  options?: UseTaskRunListOptions
): UseTaskRunListResult {
  // Backend: primary source
  const backend = useQuery({
    queryKey: taskRunDataKeys.list(options),
    queryFn: () => fetchBackendTaskRuns(options),
    staleTime: 30000,
  });

  // Runner: secondary source for live/running tasks
  const runner = useRunnerTaskRuns(options);

  const merged = mergeTaskRunSources(
    backend.data?.task_runs ?? [],
    runner.data
  );

  return {
    data: merged,
    isLoading: backend.isLoading,
    error: backend.error as Error | null,
    isBackendError: backend.isError,
    isRunnerOffline: runner.isOffline,
    refetch: () => {
      backend.refetch();
      runner.refetch();
    },
  };
}

interface UseTaskRunDetailResult {
  data: TaskRunView | null;
  isLoading: boolean;
  error: Error | null;
  isRunnerOffline: boolean;
  refetch: () => void;
}

/**
 * Fetches a single task run from the backend, overlays live runner data if running.
 */
export function useTaskRunDetail(id: string | null): UseTaskRunDetailResult {
  const backend = useQuery({
    queryKey: taskRunDataKeys.detail(id ?? ""),
    queryFn: () => fetchBackendTaskRunDetail(id!),
    enabled: !!id,
    staleTime: 10000,
  });

  // Also check runner for live data
  const runner = useRunnerTaskRuns();

  const liveRun = runner.data?.find((r) => r.id === id);

  let data: TaskRunView | null = null;
  if (liveRun) {
    // Live runner data takes priority
    data = mapRunnerTaskRun(liveRun);
  } else if (backend.data) {
    data = mapBackendTaskRun(backend.data);
  }

  return {
    data,
    isLoading: backend.isLoading && !liveRun,
    // Only report backend errors if we don't have runner data to fall back on
    error: data ? null : (backend.error as Error | null),
    isRunnerOffline: runner.isOffline,
    refetch: () => {
      backend.refetch();
      runner.refetch();
    },
  };
}

/**
 * Fetches findings summary from the backend.
 * Falls back to runner summary if backend is unavailable.
 */
export function useFindingsSummary(): {
  data: FindingsSummaryView | null;
  isLoading: boolean;
  error: Error | null;
  isRunnerOffline: boolean;
  refetch: () => void;
} {
  const backend = useQuery({
    queryKey: taskRunDataKeys.findingsSummary(),
    queryFn: fetchBackendFindingsSummary,
    staleTime: 30000,
  });

  const runner = useRunnerFindingsSummary();

  // Prefer backend data; fall back to runner
  let data: FindingsSummaryView | null = null;

  if (backend.data) {
    data = {
      total: backend.data.total,
      by_severity: backend.data.by_severity,
      by_category: backend.data.by_category,
      by_status: backend.data.by_status,
      recent: backend.data.recent.map(mapBackendFinding),
    };
  } else if (runner.data) {
    data = {
      total: runner.data.total,
      by_severity: runner.data.by_severity,
      by_category: runner.data.by_category,
      by_status: runner.data.by_status,
      recent: runner.data.recent.map((f) => ({
        id: String(f.id),
        task_run_id: f.task_run_id,
        category: f.category,
        severity: f.severity,
        status: f.status,
        title: f.title,
        description: f.description,
        file_path: f.file_path ?? null,
        line_number: f.line_number ?? null,
        created_at: f.created_at,
      })),
    };
  }

  return {
    data,
    isLoading: backend.isLoading && runner.isLoading,
    error: backend.error as Error | null,
    isRunnerOffline: runner.isOffline,
    refetch: () => {
      backend.refetch();
      runner.refetch();
    },
  };
}
