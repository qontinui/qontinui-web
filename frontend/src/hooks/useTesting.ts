/**
 * TanStack Query hooks for managing testing data
 *
 * Provides automatic caching, refetching, and optimistic updates for testing data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { testingService } from "@/services/service-factory";
import type {
  Deficiency,
  TestRunFilters,
  DeficiencyFilters,
  TestRunComparisonData,
} from "@/services/testing-service";

// Query keys for organizing cache
export const testingKeys = {
  all: ["testing"] as const,
  runs: () => [...testingKeys.all, "runs"] as const,
  runsList: (filters?: TestRunFilters) =>
    [...testingKeys.runs(), "list", { filters }] as const,
  runDetail: (id: string) => [...testingKeys.runs(), "detail", id] as const,
  runComparison: (run1Id: string, run2Id: string) =>
    [...testingKeys.runs(), "comparison", { run1Id, run2Id }] as const,
  deficiencies: () => [...testingKeys.all, "deficiencies"] as const,
  deficienciesList: (filters?: DeficiencyFilters) =>
    [...testingKeys.deficiencies(), "list", { filters }] as const,
  coverageTrends: (projectId: string, startDate?: string, endDate?: string) =>
    [
      ...testingKeys.all,
      "coverage-trends",
      { projectId, startDate, endDate },
    ] as const,
  reliabilityStats: (projectId: string, workflowId?: string) =>
    [
      ...testingKeys.all,
      "reliability-stats",
      { projectId, workflowId },
    ] as const,
  stateGraph: (projectId: string, workflowId: string) =>
    [...testingKeys.all, "state-graph", { projectId, workflowId }] as const,
};

/**
 * Hook to fetch test runs with optional filters
 */
export function useTestRuns(filters?: TestRunFilters) {
  return useQuery({
    queryKey: testingKeys.runsList(filters),
    queryFn: async () => {
      try {
        return await testingService.getTestRuns(filters);
      } catch (error) {
        console.error("[useTestRuns] Error fetching test runs:", error);
        throw error;
      }
    },
    enabled: !!filters?.project_id, // Only fetch when project_id is provided
    placeholderData: (previousData) => previousData,
    staleTime: 30000, // Consider data stale after 30 seconds
  });
}

/**
 * Hook to fetch a single test run by ID
 */
export function useTestRun(id: string, enabled = true) {
  return useQuery({
    queryKey: testingKeys.runDetail(id),
    queryFn: async () => {
      try {
        return await testingService.getTestRun(id);
      } catch (error) {
        console.error("[useTestRun] Error fetching test run:", error);
        throw error;
      }
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to compare two test runs
 */
export function useTestRunComparison(
  run1Id: string,
  run2Id: string,
  enabled = true
) {
  return useQuery({
    queryKey: testingKeys.runComparison(run1Id, run2Id),
    queryFn: async () => {
      try {
        return await testingService.compareTestRuns(run1Id, run2Id);
      } catch (error) {
        console.error(
          "[useTestRunComparison] Error comparing test runs:",
          error
        );
        throw error;
      }
    },
    enabled: enabled && !!run1Id && !!run2Id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch deficiencies with optional filters
 */
export function useDeficiencies(filters?: DeficiencyFilters) {
  return useQuery({
    queryKey: testingKeys.deficienciesList(filters),
    queryFn: async () => {
      try {
        return await testingService.getDeficiencies(filters);
      } catch (error) {
        console.error("[useDeficiencies] Error fetching deficiencies:", error);
        throw error;
      }
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  });
}

/**
 * Hook to update a deficiency
 */
export function useUpdateDeficiency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Deficiency>;
    }) => {
      return await testingService.updateDeficiency(id, data);
    },
    onSuccess: () => {
      // Invalidate deficiency lists to refetch
      queryClient.invalidateQueries({ queryKey: testingKeys.deficiencies() });

      // Update the specific deficiency in any test run details that contain it
      queryClient.invalidateQueries({ queryKey: testingKeys.runs() });
    },
  });
}

/**
 * Hook to fetch coverage trends over time
 */
export function useCoverageTrends(
  projectId: string,
  startDate?: string,
  endDate?: string,
  enabled = true
) {
  return useQuery({
    queryKey: testingKeys.coverageTrends(projectId, startDate, endDate),
    queryFn: async () => {
      try {
        return await testingService.getCoverageTrends(
          projectId,
          startDate,
          endDate
        );
      } catch (error) {
        console.error(
          "[useCoverageTrends] Error fetching coverage trends:",
          error
        );
        throw error;
      }
    },
    enabled: enabled && !!projectId,
    placeholderData: (previousData) => previousData,
    staleTime: 60000, // Coverage trends are less volatile, cache for 1 minute
  });
}

/**
 * Hook to fetch reliability statistics
 */
export function useReliabilityStats(
  projectId: string,
  workflowId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: testingKeys.reliabilityStats(projectId, workflowId),
    queryFn: async () => {
      try {
        return await testingService.getReliabilityStats(projectId, workflowId);
      } catch (error) {
        console.error(
          "[useReliabilityStats] Error fetching reliability stats:",
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

/**
 * Hook to fetch state graph data for visualization
 */
export function useStateGraph(
  projectId: string,
  workflowId: string,
  enabled = true
) {
  return useQuery({
    queryKey: testingKeys.stateGraph(projectId, workflowId),
    queryFn: async () => {
      try {
        return await testingService.getStateGraph(projectId, workflowId);
      } catch (error) {
        console.error("[useStateGraph] Error fetching state graph:", error);
        throw error;
      }
    },
    enabled: enabled && !!projectId && !!workflowId,
    placeholderData: (previousData) => previousData,
    staleTime: 120000, // State graph is expensive to compute, cache for 2 minutes
  });
}

/**
 * Hook to export test run data
 */
export function useExportTestRun() {
  return useMutation({
    mutationFn: async ({
      id,
      format,
    }: {
      id: string;
      format: "json" | "csv" | "pdf";
    }) => {
      const blob = await testingService.exportTestRun(id, format);

      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `test-run-${id}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });
}

/**
 * Hook to export deficiencies data
 */
export function useExportDeficiencies() {
  return useMutation({
    mutationFn: async ({
      filters,
      format,
    }: {
      filters: DeficiencyFilters;
      format: "json" | "csv";
    }) => {
      const blob = await testingService.exportDeficiencies(filters, format);

      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deficiencies-export.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });
}
