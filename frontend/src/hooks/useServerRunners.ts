"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Runner } from "@qontinui/shared-types";
import { listRunners, getRunner, deleteRunner } from "@/lib/api/runners";
import {
  createRunnerToken,
  listRunnerTokens,
  revokeRunnerToken,
} from "@/lib/api/runner_tokens";
import { dispatchWorkflow, DispatchError } from "@/lib/api/workflow_dispatch";
import { listPhaseResults, getPhaseResult } from "@/lib/api/phase_results";
import {
  listScheduledRuns,
  getScheduledRun,
  createScheduledRun,
  updateScheduledRun,
  deleteScheduledRun,
  runScheduledRunNow,
} from "@/lib/api/scheduled_runs";
import type {
  CreateRunnerTokenRequest,
  CreateScheduledRunRequest,
  DispatchRequest,
  UpdateScheduledRunRequest,
} from "@/types/server-runner";

/**
 * React Query hooks for the unified runner endpoint surface, runner
 * tokens, workflow dispatch, phase results and scheduled runs.
 */

// =============================================================================
// Query keys
// =============================================================================

export const serverRunnerKeys = {
  all: ["server-runners"] as const,
  runners: () => [...serverRunnerKeys.all, "runners"] as const,
  runner: (id: string) => [...serverRunnerKeys.all, "runner", id] as const,
  tokens: () => [...serverRunnerKeys.all, "tokens"] as const,
  phaseResults: (executionId: string) =>
    [...serverRunnerKeys.all, "phase-results", executionId] as const,
  phaseResult: (id: string) =>
    [...serverRunnerKeys.all, "phase-result", id] as const,
  scheduledRuns: (workflowId?: string) =>
    [...serverRunnerKeys.all, "scheduled-runs", workflowId ?? "all"] as const,
  scheduledRun: (id: string) =>
    [...serverRunnerKeys.all, "scheduled-run", id] as const,
};

// =============================================================================
// Runners
// =============================================================================

export function useRunners(refetchIntervalMs: number = 10000) {
  return useQuery<Runner[], Error>({
    queryKey: serverRunnerKeys.runners(),
    queryFn: () => listRunners(),
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return refetchIntervalMs;
    },
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useRunner(runnerId: string | null) {
  return useQuery<Runner, Error>({
    queryKey: runnerId ? serverRunnerKeys.runner(runnerId) : ["runner", null],
    queryFn: () => getRunner(runnerId as string),
    enabled: Boolean(runnerId),
  });
}

export function useDeregisterRunner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRunner,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.runners() });
      toast.success("Runner deregistered");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to deregister runner");
    },
  });
}

// =============================================================================
// Runner tokens
// =============================================================================

export function useRunnerTokens() {
  return useQuery({
    queryKey: serverRunnerKeys.tokens(),
    queryFn: listRunnerTokens,
    retry: 1,
  });
}

export function useCreateRunnerToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRunnerTokenRequest) => createRunnerToken(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.tokens() });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create runner token");
    },
  });
}

export function useRevokeRunnerToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeRunnerToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.tokens() });
      toast.success("Token revoked");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to revoke token");
    },
  });
}

// =============================================================================
// Workflow dispatch
// =============================================================================

export function useDispatchWorkflow() {
  return useMutation({
    mutationFn: ({
      runnerId,
      data,
    }: {
      runnerId: string;
      data: DispatchRequest;
    }) => dispatchWorkflow(runnerId, data),
  });
}

export { DispatchError };

// =============================================================================
// Phase results
// =============================================================================

/**
 * Poll phase results for an execution. Polling interval defaults to 5s.
 * Stops when the backend errors out (e.g. execution_id not found yet).
 */
export function usePhaseResults(
  executionId: string | null,
  pollMs: number = 5000
) {
  return useQuery({
    queryKey: executionId
      ? serverRunnerKeys.phaseResults(executionId)
      : ["phase-results", null],
    queryFn: () => listPhaseResults(executionId as string),
    enabled: Boolean(executionId),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return pollMs;
    },
    refetchIntervalInBackground: false,
  });
}

export function usePhaseResult(id: string | null) {
  return useQuery({
    queryKey: id ? serverRunnerKeys.phaseResult(id) : ["phase-result", null],
    queryFn: () => getPhaseResult(id as string),
    enabled: Boolean(id),
  });
}

// =============================================================================
// Scheduled runs
// =============================================================================

export function useScheduledRuns(workflowId?: string) {
  return useQuery({
    queryKey: serverRunnerKeys.scheduledRuns(workflowId),
    queryFn: () => listScheduledRuns(workflowId),
    retry: 1,
  });
}

export function useScheduledRun(id: string | null) {
  return useQuery({
    queryKey: id ? serverRunnerKeys.scheduledRun(id) : ["scheduled-run", null],
    queryFn: () => getScheduledRun(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateScheduledRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateScheduledRunRequest) => createScheduledRun(data),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.all });
      toast.success(`Schedule "${created.name}" created`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create schedule");
    },
  });
}

export function useUpdateScheduledRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateScheduledRunRequest;
    }) => updateScheduledRun(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.all });
      toast.success("Schedule updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update schedule");
    },
  });
}

export function useDeleteScheduledRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteScheduledRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.all });
      toast.success("Schedule deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete schedule");
    },
  });
}

export function useRunScheduledRunNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runScheduledRunNow,
    onSuccess: (_result) => {
      qc.invalidateQueries({ queryKey: serverRunnerKeys.all });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to run schedule now");
    },
  });
}
