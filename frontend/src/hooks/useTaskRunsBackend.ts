/**
 * TanStack Query hooks for managing Task Runs data from the backend
 *
 * Provides automatic caching, refetching, and optimistic updates for task runs data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskRunsService } from "@/services/service-factory";
import type {
  TaskRunFilters,
  TaskRunFindingFilters,
  TaskRunFindingUpdate,
  TaskRunCreate,
  TaskRunUpdate,
  TaskRunFindingCreate,
} from "@/types/task-runs";

// Query keys for organizing cache
export const taskRunsKeys = {
  all: ["task-runs"] as const,
  lists: () => [...taskRunsKeys.all, "list"] as const,
  list: (filters?: TaskRunFilters) =>
    [...taskRunsKeys.lists(), { filters }] as const,
  details: () => [...taskRunsKeys.all, "detail"] as const,
  detail: (id: string) => [...taskRunsKeys.details(), id] as const,
  findings: (taskId: string) =>
    [...taskRunsKeys.all, "findings", taskId] as const,
  findingsList: (taskId: string, filters?: TaskRunFindingFilters) =>
    [...taskRunsKeys.findings(taskId), "list", { filters }] as const,
  findingsSummary: () => [...taskRunsKeys.all, "findings-summary"] as const,
  verificationResults: (taskId: string) =>
    [...taskRunsKeys.all, "verification-results", taskId] as const,
};

/**
 * Hook to fetch task runs with optional filters
 */
export function useBackendTaskRuns(filters?: TaskRunFilters) {
  return useQuery({
    queryKey: taskRunsKeys.list(filters),
    queryFn: async () => {
      try {
        return await taskRunsService.listTasks(filters);
      } catch (error) {
        console.error("[useBackendTaskRuns] Error fetching task runs:", error);
        throw error;
      }
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30000, // Consider data stale after 30 seconds
  });
}

/**
 * Hook to fetch a single task run by ID with full details
 */
export function useBackendTaskRun(id: string, enabled = true) {
  return useQuery({
    queryKey: taskRunsKeys.detail(id),
    queryFn: async () => {
      try {
        return await taskRunsService.getTaskDetail(id);
      } catch (error) {
        console.error("[useBackendTaskRun] Error fetching task run:", error);
        throw error;
      }
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch findings for a task run with optional filters
 */
export function useBackendTaskRunFindings(
  taskId: string,
  filters?: TaskRunFindingFilters,
  enabled = true
) {
  return useQuery({
    queryKey: taskRunsKeys.findingsList(taskId, filters),
    queryFn: async () => {
      try {
        return await taskRunsService.listFindings(taskId, filters);
      } catch (error) {
        console.error(
          "[useBackendTaskRunFindings] Error fetching findings:",
          error
        );
        throw error;
      }
    },
    enabled: enabled && !!taskId,
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch findings summary across all task runs
 */
export function useBackendFindingsSummary(enabled = true) {
  return useQuery({
    queryKey: taskRunsKeys.findingsSummary(),
    queryFn: () => taskRunsService.getFindingsSummary(),
    enabled,
    staleTime: 30000,
  });
}

/**
 * Hook to create a new task run
 */
export function useCreateBackendTaskRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TaskRunCreate) => {
      return await taskRunsService.createTask(data);
    },
    onSuccess: () => {
      // Invalidate all task run lists to refetch
      queryClient.invalidateQueries({ queryKey: taskRunsKeys.lists() });
    },
  });
}

/**
 * Hook to update a task run
 */
export function useUpdateBackendTaskRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TaskRunUpdate }) => {
      return await taskRunsService.updateTask(id, data);
    },
    onSuccess: (_, variables) => {
      // Invalidate the specific task run detail
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.detail(variables.id),
      });
      // Invalidate all task run lists to refetch
      queryClient.invalidateQueries({ queryKey: taskRunsKeys.lists() });
    },
  });
}

/**
 * Hook to delete a task run
 */
export function useDeleteBackendTaskRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return await taskRunsService.deleteTask(id);
    },
    onSuccess: (_, id) => {
      // Remove the task run from cache
      queryClient.removeQueries({ queryKey: taskRunsKeys.detail(id) });
      // Invalidate all task run lists to refetch
      queryClient.invalidateQueries({ queryKey: taskRunsKeys.lists() });
    },
  });
}

/**
 * Hook to update a finding's status
 */
export function useUpdateBackendFindingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      findingId,
      data,
    }: {
      taskId: string;
      findingId: string;
      data: TaskRunFindingUpdate;
    }) => {
      return await taskRunsService.updateFinding(taskId, findingId, data);
    },
    onSuccess: (_, variables) => {
      // Invalidate findings list to refetch
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.findings(variables.taskId),
      });
      // Invalidate task run detail as it includes findings
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.detail(variables.taskId),
      });
    },
  });
}

/**
 * Hook to submit a user response to a finding that needs input
 */
export function useSubmitBackendFindingResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      findingId,
      response,
    }: {
      taskId: string;
      findingId: string;
      response: string;
    }) => {
      return await taskRunsService.submitFindingResponse(
        taskId,
        findingId,
        response
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate findings list to refetch
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.findings(variables.taskId),
      });
      // Invalidate task run detail as it includes findings
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.detail(variables.taskId),
      });
    },
  });
}

/**
 * Hook to sync findings for a task run
 */
export function useSyncBackendFindings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      findings,
    }: {
      taskId: string;
      findings: TaskRunFindingCreate[];
    }) => {
      return await taskRunsService.syncFindings(taskId, findings);
    },
    onSuccess: (_, variables) => {
      // Invalidate findings list to refetch
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.findings(variables.taskId),
      });
      // Invalidate task run detail as it includes findings
      queryClient.invalidateQueries({
        queryKey: taskRunsKeys.detail(variables.taskId),
      });
    },
  });
}

/**
 * Hook to fetch verification results for a task run
 */
export function useBackendVerificationResults(taskId: string, enabled = true) {
  return useQuery({
    queryKey: taskRunsKeys.verificationResults(taskId),
    queryFn: async () => {
      try {
        return await taskRunsService.listVerificationResults(taskId);
      } catch (error) {
        console.error(
          "[useBackendVerificationResults] Error fetching verification results:",
          error
        );
        throw error;
      }
    },
    enabled: enabled && !!taskId,
    staleTime: 10000,
  });
}
