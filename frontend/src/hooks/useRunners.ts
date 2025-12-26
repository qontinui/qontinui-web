import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { runnerService } from "@/services/service-factory";
import type {
  RunnerConnection,
  ConnectionHistoryParams,
  ConnectionHistoryResponse,
} from "@/types/runner";
import { toast } from "sonner";

/**
 * React Query hooks for runner connection management
 */

// Query keys
export const runnerKeys = {
  all: ["runners"] as const,
  activeConnections: () => [...runnerKeys.all, "active-connections"] as const,
  connectionHistory: (params: ConnectionHistoryParams) =>
    [...runnerKeys.all, "connection-history", params] as const,
};

/**
 * Fetch active connections with auto-refresh
 */
export function useActiveConnections(refetchInterval: number = 5000) {
  return useQuery<RunnerConnection[], Error>({
    queryKey: runnerKeys.activeConnections(),
    queryFn: () => runnerService.getActiveConnections(),
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
 * Fetch connection history with pagination
 */
export function useConnectionHistory(params: ConnectionHistoryParams = {}) {
  return useQuery<ConnectionHistoryResponse, Error>({
    queryKey: runnerKeys.connectionHistory(params),
    queryFn: () => runnerService.getConnectionHistory(params),
    retry: 1,
    retryDelay: 1000,
  });
}

/**
 * Disconnect an active runner connection
 */
export function useDisconnectRunner() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (connectionId: number) =>
      runnerService.disconnectRunner(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: runnerKeys.activeConnections(),
      });
      queryClient.invalidateQueries({
        queryKey: runnerKeys.connectionHistory({}),
      });
      toast.success("Runner disconnected successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to disconnect runner");
    },
  });
}
