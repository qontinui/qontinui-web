import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { runnerService } from "@/services/service-factory";
import type { Runner } from "@qontinui/shared-types";
import type {
  RunnerSessionFilters,
  RunnerSessionsResponse,
} from "@/types/runner";
import { toast } from "sonner";

/**
 * React Query hooks for the unified runner endpoint surface.
 */

// Query keys
export const runnerKeys = {
  all: ["runners"] as const,
  list: (status?: string) => [...runnerKeys.all, "list", status ?? ""] as const,
  online: () => [...runnerKeys.all, "online"] as const,
  sessions: (filters: RunnerSessionFilters) =>
    [...runnerKeys.all, "sessions", filters] as const,
};

const ONLINE_STATUS_FILTER = "healthy,degraded,starting";

/**
 * Fetch online runners with auto-refresh. "Online" = derivedStatus in
 * `{healthy, degraded, starting}` — anything reachable.
 */
export function useOnlineRunners(refetchInterval: number = 30000) {
  return useQuery<Runner[], Error>({
    queryKey: runnerKeys.online(),
    queryFn: () => runnerService.getRunners(ONLINE_STATUS_FILTER),
    refetchInterval: (query) => {
      // Stop auto-refresh if there's an error (server offline)
      if (query.state.error) return false;
      return refetchInterval;
    },
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/**
 * Fetch runner-session audit log with pagination.
 */
export function useRunnerSessions(filters: RunnerSessionFilters = {}) {
  return useQuery<RunnerSessionsResponse, Error>({
    queryKey: runnerKeys.sessions(filters),
    queryFn: () => runnerService.getSessionHistory(filters),
    retry: 1,
    retryDelay: 1000,
  });
}

/**
 * Deregister a runner. Closes its WebSocket and removes it from the fleet.
 */
export function useDeleteRunner() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (runnerId: string) => runnerService.deleteRunner(runnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runnerKeys.all });
      toast.success("Runner deregistered");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to deregister runner");
    },
  });
}
