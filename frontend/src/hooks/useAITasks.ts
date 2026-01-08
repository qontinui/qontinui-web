/**
 * TanStack Query hooks for managing AI Tasks data
 *
 * Provides automatic caching, refetching, and optimistic updates for AI tasks data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aiTasksService } from "@/services/service-factory";
import type {
  AITaskFilters,
  AITaskFindingFilters,
  AITaskFindingUpdate,
  AITaskCreate,
  AITaskUpdate,
  AITaskFindingCreate,
} from "@/types/ai-tasks";

// Query keys for organizing cache
export const aiTasksKeys = {
  all: ["ai-tasks"] as const,
  lists: () => [...aiTasksKeys.all, "list"] as const,
  list: (filters?: AITaskFilters) =>
    [...aiTasksKeys.lists(), { filters }] as const,
  details: () => [...aiTasksKeys.all, "detail"] as const,
  detail: (id: string) => [...aiTasksKeys.details(), id] as const,
  findings: (taskId: string) =>
    [...aiTasksKeys.all, "findings", taskId] as const,
  findingsList: (taskId: string, filters?: AITaskFindingFilters) =>
    [...aiTasksKeys.findings(taskId), "list", { filters }] as const,
};

/**
 * Hook to fetch AI tasks with optional filters
 */
export function useAITasks(filters?: AITaskFilters) {
  return useQuery({
    queryKey: aiTasksKeys.list(filters),
    queryFn: async () => {
      try {
        return await aiTasksService.listTasks(filters);
      } catch (error) {
        console.error("[useAITasks] Error fetching AI tasks:", error);
        throw error;
      }
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30000, // Consider data stale after 30 seconds
  });
}

/**
 * Hook to fetch a single AI task by ID with full details
 */
export function useAITask(id: string, enabled = true) {
  return useQuery({
    queryKey: aiTasksKeys.detail(id),
    queryFn: async () => {
      try {
        return await aiTasksService.getTaskDetail(id);
      } catch (error) {
        console.error("[useAITask] Error fetching AI task:", error);
        throw error;
      }
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch findings for an AI task with optional filters
 */
export function useAITaskFindings(
  taskId: string,
  filters?: AITaskFindingFilters,
  enabled = true
) {
  return useQuery({
    queryKey: aiTasksKeys.findingsList(taskId, filters),
    queryFn: async () => {
      try {
        return await aiTasksService.listFindings(taskId, filters);
      } catch (error) {
        console.error("[useAITaskFindings] Error fetching findings:", error);
        throw error;
      }
    },
    enabled: enabled && !!taskId,
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  });
}

/**
 * Hook to create a new AI task
 */
export function useCreateAITask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AITaskCreate) => {
      return await aiTasksService.createTask(data);
    },
    onSuccess: () => {
      // Invalidate all task lists to refetch
      queryClient.invalidateQueries({ queryKey: aiTasksKeys.lists() });
    },
  });
}

/**
 * Hook to update an AI task
 */
export function useUpdateAITask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: AITaskUpdate }) => {
      return await aiTasksService.updateTask(id, data);
    },
    onSuccess: (_, variables) => {
      // Invalidate the specific task detail
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.detail(variables.id),
      });
      // Invalidate all task lists to refetch
      queryClient.invalidateQueries({ queryKey: aiTasksKeys.lists() });
    },
  });
}

/**
 * Hook to delete an AI task
 */
export function useDeleteAITask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return await aiTasksService.deleteTask(id);
    },
    onSuccess: (_, id) => {
      // Remove the task from cache
      queryClient.removeQueries({ queryKey: aiTasksKeys.detail(id) });
      // Invalidate all task lists to refetch
      queryClient.invalidateQueries({ queryKey: aiTasksKeys.lists() });
    },
  });
}

/**
 * Hook to update a finding's status
 */
export function useUpdateFindingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      findingId,
      data,
    }: {
      taskId: string;
      findingId: string;
      data: AITaskFindingUpdate;
    }) => {
      return await aiTasksService.updateFinding(taskId, findingId, data);
    },
    onSuccess: (_, variables) => {
      // Invalidate findings list to refetch
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.findings(variables.taskId),
      });
      // Invalidate task detail as it includes findings
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.detail(variables.taskId),
      });
    },
  });
}

/**
 * Hook to submit a user response to a finding that needs input
 */
export function useSubmitFindingResponse() {
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
      return await aiTasksService.submitFindingResponse(
        taskId,
        findingId,
        response
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate findings list to refetch
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.findings(variables.taskId),
      });
      // Invalidate task detail as it includes findings
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.detail(variables.taskId),
      });
    },
  });
}

/**
 * Hook to sync findings for a task
 */
export function useSyncFindings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      findings,
    }: {
      taskId: string;
      findings: AITaskFindingCreate[];
    }) => {
      return await aiTasksService.syncFindings(taskId, findings);
    },
    onSuccess: (_, variables) => {
      // Invalidate findings list to refetch
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.findings(variables.taskId),
      });
      // Invalidate task detail as it includes findings
      queryClient.invalidateQueries({
        queryKey: aiTasksKeys.detail(variables.taskId),
      });
    },
  });
}
