import { useQuery, useMutation } from "@tanstack/react-query";
import { ragDashboardService } from "@/services/service-factory";
import type {
  RAGDashboardStats,
  EmbeddingListResponse,
  EmbeddingsParams,
  JobListResponse,
  JobsParams,
  SemanticSearchRequest,
  SemanticSearchResponse,
  StatesResponse,
} from "@/types/rag-dashboard";

/**
 * React Query hooks for RAG Dashboard
 */

// Query keys
export const ragDashboardKeys = {
  all: ["rag-dashboard"] as const,
  dashboard: (projectId: string) =>
    [...ragDashboardKeys.all, "dashboard", projectId] as const,
  embeddings: (projectId: string, params: EmbeddingsParams) =>
    [...ragDashboardKeys.all, "embeddings", projectId, params] as const,
  jobs: (projectId: string, params: JobsParams) =>
    [...ragDashboardKeys.all, "jobs", projectId, params] as const,
  states: (projectId: string) =>
    [...ragDashboardKeys.all, "states", projectId] as const,
  search: (projectId: string, query: string) =>
    [...ragDashboardKeys.all, "search", projectId, query] as const,
};

/**
 * Fetch RAG dashboard summary statistics.
 * Auto-refreshes when there's an active job.
 */
export function useRAGDashboard(projectId: string) {
  return useQuery<RAGDashboardStats, Error>({
    queryKey: ragDashboardKeys.dashboard(projectId),
    queryFn: () => ragDashboardService.getDashboard(projectId),
    enabled: !!projectId,
    retry: 1,
    refetchInterval: (query) => {
      // Auto-refresh every 5 seconds if there's an active job
      const data = query.state.data;
      if (data?.active_job?.status === "in_progress") {
        return 5000;
      }
      return false;
    },
  });
}

/**
 * Fetch paginated list of embeddings.
 */
export function useRAGEmbeddings(
  projectId: string,
  params: EmbeddingsParams = {}
) {
  return useQuery<EmbeddingListResponse, Error>({
    queryKey: ragDashboardKeys.embeddings(projectId, params),
    queryFn: () => ragDashboardService.getEmbeddings(projectId, params),
    enabled: !!projectId,
    retry: 1,
  });
}

/**
 * Fetch paginated list of embedding generation jobs.
 * Auto-refreshes when viewing in-progress jobs.
 */
export function useRAGJobs(
  projectId: string,
  params: JobsParams = {},
  autoRefresh: boolean = true
) {
  return useQuery<JobListResponse, Error>({
    queryKey: ragDashboardKeys.jobs(projectId, params),
    queryFn: () => ragDashboardService.getJobs(projectId, params),
    enabled: !!projectId,
    retry: 1,
    refetchInterval: (query) => {
      if (!autoRefresh) return false;
      // Auto-refresh every 5 seconds if any job is in progress
      const data = query.state.data;
      const hasActiveJob = data?.items.some(
        (job) => job.status === "pending" || job.status === "in_progress"
      );
      return hasActiveJob ? 5000 : false;
    },
  });
}

/**
 * Fetch unique states for filter dropdown.
 */
export function useRAGStates(projectId: string) {
  return useQuery<StatesResponse, Error>({
    queryKey: ragDashboardKeys.states(projectId),
    queryFn: () => ragDashboardService.getStates(projectId),
    enabled: !!projectId,
    retry: 1,
    staleTime: 60000, // Cache for 1 minute
  });
}

/**
 * Semantic search mutation.
 * Uses mutation instead of query because search is user-triggered.
 */
export function useRAGSearch(projectId: string) {
  return useMutation<SemanticSearchResponse, Error, SemanticSearchRequest>({
    mutationFn: (request) => ragDashboardService.search(projectId, request),
  });
}
