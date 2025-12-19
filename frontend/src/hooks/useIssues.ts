/**
 * TanStack Query hooks for managing detected issues
 *
 * Provides automatic caching, refetching, and optimistic updates for issue data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesService } from "@/services/service-factory";
import { IssueStatus } from "@/types/detected-issue";
import type {
  DetectedIssueUpdate,
  IssueFilters,
} from "@/types/detected-issue";
import type {
  IssuesSyncRequest,
  IssuesSyncResponse,
} from "@/services/issues-service";

// Query keys for organizing cache
export const issueKeys = {
  all: ["issues"] as const,
  lists: () => [...issueKeys.all, "list"] as const,
  list: (filters?: IssueFilters) =>
    [...issueKeys.lists(), { filters }] as const,
  details: () => [...issueKeys.all, "detail"] as const,
  detail: (id: string) => [...issueKeys.details(), id] as const,
  stats: (projectId?: string) =>
    [...issueKeys.all, "stats", { projectId }] as const,
};

/**
 * Hook to fetch issues with optional filters
 */
export function useIssues(filters?: IssueFilters, enabled = true) {
  return useQuery({
    queryKey: issueKeys.list(filters),
    queryFn: async () => {
      try {
        return await issuesService.getIssues(filters);
      } catch (error) {
        console.error("[useIssues] Error fetching issues:", error);
        throw error;
      }
    },
    enabled,
    placeholderData: (previousData) => previousData,
    staleTime: 30000, // Consider data stale after 30 seconds
  });
}

/**
 * Hook to fetch a single issue by ID
 */
export function useIssue(id: string, enabled = true) {
  return useQuery({
    queryKey: issueKeys.detail(id),
    queryFn: async () => {
      try {
        return await issuesService.getIssue(id);
      } catch (error) {
        console.error("[useIssue] Error fetching issue:", error);
        throw error;
      }
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch issue statistics
 */
export function useIssueStats(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: issueKeys.stats(projectId),
    queryFn: async () => {
      try {
        return await issuesService.getStats(projectId);
      } catch (error) {
        console.error("[useIssueStats] Error fetching issue stats:", error);
        throw error;
      }
    },
    enabled,
    placeholderData: (previousData) => previousData,
    staleTime: 60000, // Stats are less volatile, cache for 1 minute
  });
}

/**
 * Hook to update an issue
 */
export function useUpdateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: DetectedIssueUpdate;
    }) => {
      return await issuesService.updateIssue(id, data);
    },
    onSuccess: (updatedIssue) => {
      // Update the issue in the cache
      queryClient.setQueryData(
        issueKeys.detail(updatedIssue.id),
        updatedIssue
      );

      // Invalidate lists to refetch
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });

      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: issueKeys.stats() });
    },
  });
}

/**
 * Hook to delete an issue
 */
export function useDeleteIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await issuesService.deleteIssue(id);
      return id;
    },
    onSuccess: (deletedId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: issueKeys.detail(deletedId) });

      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });

      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: issueKeys.stats() });
    },
  });
}

/**
 * Hook to sync issues from runner
 */
export function useSyncIssues() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: IssuesSyncRequest): Promise<IssuesSyncResponse> => {
      return await issuesService.syncIssues(request);
    },
    onSuccess: () => {
      // Invalidate all issue queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
    },
  });
}

/**
 * Hook to mark an issue as resolved
 */
export function useResolveIssue() {
  const updateIssue = useUpdateIssue();

  return useMutation({
    mutationFn: async ({
      id,
      resolution,
    }: {
      id: string;
      resolution?: string;
    }) => {
      return await updateIssue.mutateAsync({
        id,
        data: { status: IssueStatus.RESOLVED, resolution },
      });
    },
  });
}

/**
 * Hook to mark an issue as in progress
 */
export function useStartIssue() {
  const updateIssue = useUpdateIssue();

  return useMutation({
    mutationFn: async (id: string) => {
      return await updateIssue.mutateAsync({
        id,
        data: { status: IssueStatus.IN_PROGRESS },
      });
    },
  });
}

/**
 * Hook to skip an issue
 */
export function useSkipIssue() {
  const updateIssue = useUpdateIssue();

  return useMutation({
    mutationFn: async (id: string) => {
      return await updateIssue.mutateAsync({
        id,
        data: { status: IssueStatus.SKIPPED },
      });
    },
  });
}
