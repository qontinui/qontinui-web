/**
 * TanStack Query hooks for managing unified execution data
 *
 * Provides automatic caching, refetching, and optimistic updates for execution data.
 * This replaces the testing-focused hooks with a unified execution model.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listExecutionRuns,
  getExecutionRun,
  listIssues,
  getIssue,
  updateIssue,
  getExecutionTrends,
  getActionReliability,
  listActions,
} from "@/services/execution-service";
import type {
  RunType,
  RunStatus,
  IssueStatus,
  IssueSeverity,
  ExecutionIssueUpdate,
} from "@/types/generated/execution";

// =============================================================================
// Query Keys
// =============================================================================

export const executionKeys = {
  all: ["execution"] as const,
  // Runs
  runs: () => [...executionKeys.all, "runs"] as const,
  runsList: (filters?: ExecutionRunFilters) =>
    [...executionKeys.runs(), "list", { filters }] as const,
  runDetail: (id: string) => [...executionKeys.runs(), "detail", id] as const,
  // Actions
  actions: () => [...executionKeys.all, "actions"] as const,
  runActions: (runId: string, params?: { limit?: number; offset?: number }) =>
    [...executionKeys.actions(), "run", runId, params] as const,
  // Issues
  issues: () => [...executionKeys.all, "issues"] as const,
  issuesList: (filters?: ExecutionIssueFilters) =>
    [...executionKeys.issues(), "list", { filters }] as const,
  issueDetail: (id: string) =>
    [...executionKeys.issues(), "detail", id] as const,
  // Analytics
  trends: (
    projectId: string,
    runType?: RunType,
    startDate?: string,
    endDate?: string
  ) =>
    [
      ...executionKeys.all,
      "trends",
      { projectId, runType, startDate, endDate },
    ] as const,
  reliability: (
    projectId: string,
    workflowId?: string,
    startDate?: string,
    endDate?: string
  ) =>
    [
      ...executionKeys.all,
      "reliability",
      { projectId, workflowId, startDate, endDate },
    ] as const,
};

// =============================================================================
// Filter Types
// =============================================================================

export interface ExecutionRunFilters {
  project_id?: string;
  run_type?: RunType;
  status?: RunStatus;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface ExecutionIssueFilters {
  project_id?: string;
  run_id?: string;
  status?: IssueStatus;
  severity?: IssueSeverity;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Execution Run Hooks
// =============================================================================

/**
 * Hook to fetch execution runs with optional filters
 */
export function useExecutionRuns(filters?: ExecutionRunFilters) {
  return useQuery({
    queryKey: executionKeys.runsList(filters),
    queryFn: async () => {
      try {
        return await listExecutionRuns(filters || {});
      } catch (error) {
        console.error("[useExecutionRuns] Error fetching runs:", error);
        throw error;
      }
    },
    enabled: !!filters?.project_id,
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch a single execution run by ID
 */
export function useExecutionRun(id: string, enabled = true) {
  return useQuery({
    queryKey: executionKeys.runDetail(id),
    queryFn: async () => {
      try {
        return await getExecutionRun(id);
      } catch (error) {
        console.error("[useExecutionRun] Error fetching run:", error);
        throw error;
      }
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch actions for a specific run
 */
export function useRunActions(
  runId: string,
  params?: { limit?: number; offset?: number },
  enabled = true
) {
  return useQuery({
    queryKey: executionKeys.runActions(runId, params),
    queryFn: async () => {
      try {
        return await listActions(runId, params);
      } catch (error) {
        console.error("[useRunActions] Error fetching actions:", error);
        throw error;
      }
    },
    enabled: enabled && !!runId,
    placeholderData: (previousData) => previousData,
  });
}

// =============================================================================
// Issue Hooks
// =============================================================================

/**
 * Hook to fetch issues with optional filters
 */
export function useExecutionIssues(filters?: ExecutionIssueFilters) {
  return useQuery({
    queryKey: executionKeys.issuesList(filters),
    queryFn: async () => {
      try {
        return await listIssues(filters || {});
      } catch (error) {
        console.error("[useExecutionIssues] Error fetching issues:", error);
        throw error;
      }
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch a single issue by ID
 */
export function useExecutionIssue(id: string, enabled = true) {
  return useQuery({
    queryKey: executionKeys.issueDetail(id),
    queryFn: async () => {
      try {
        return await getIssue(id);
      } catch (error) {
        console.error("[useExecutionIssue] Error fetching issue:", error);
        throw error;
      }
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to update an issue
 */
export function useUpdateExecutionIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: ExecutionIssueUpdate;
    }) => {
      return await updateIssue(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: executionKeys.issues() });
      queryClient.invalidateQueries({ queryKey: executionKeys.runs() });
    },
  });
}

// =============================================================================
// Analytics Hooks
// =============================================================================

/**
 * Hook to fetch execution trends
 */
export function useExecutionTrends(
  projectId: string,
  options?: {
    runType?: RunType;
    startDate?: string;
    endDate?: string;
    granularity?: "daily" | "weekly" | "monthly";
  },
  enabled = true
) {
  const { runType, startDate, endDate, granularity } = options || {};

  // Compute default dates outside the query function
  const now = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const defaultStartDate = thirtyDaysAgo.toISOString().slice(0, 10);
  const defaultEndDate = now.toISOString().slice(0, 10);

  return useQuery({
    queryKey: executionKeys.trends(projectId, runType, startDate, endDate),
    queryFn: async () => {
      try {
        return await getExecutionTrends({
          project_id: projectId,
          run_type: runType,
          start_date: startDate || defaultStartDate,
          end_date: endDate || defaultEndDate,
          granularity: granularity || "daily",
        });
      } catch (error) {
        console.error("[useExecutionTrends] Error fetching trends:", error);
        throw error;
      }
    },
    enabled: enabled && !!projectId,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
  });
}

/**
 * Hook to fetch action reliability statistics
 */
export function useActionReliability(
  projectId: string,
  options?: {
    workflowId?: string;
    startDate?: string;
    endDate?: string;
  },
  enabled = true
) {
  const { workflowId, startDate, endDate } = options || {};

  return useQuery({
    queryKey: executionKeys.reliability(
      projectId,
      workflowId,
      startDate,
      endDate
    ),
    queryFn: async () => {
      try {
        return await getActionReliability({
          project_id: projectId,
          workflow_id: workflowId,
          start_date: startDate,
          end_date: endDate,
        });
      } catch (error) {
        console.error(
          "[useActionReliability] Error fetching reliability:",
          error
        );
        throw error;
      }
    },
    enabled: enabled && !!projectId,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
  });
}
