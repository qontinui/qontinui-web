import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { runnerService } from "@/services/service-factory";
import type {
  RunnerToken,
  RunnerTokenWithSecret,
  RunnerConnection,
  ConnectionHistoryParams,
  ConnectionHistoryResponse,
} from "@/types/runner";
import { toast } from "sonner";

/**
 * React Query hooks for runner management
 */

// Query keys
export const runnerKeys = {
  all: ["runners"] as const,
  tokens: () => [...runnerKeys.all, "tokens"] as const,
  token: (id: string) => [...runnerKeys.all, "token", id] as const,
  activeConnections: () => [...runnerKeys.all, "active-connections"] as const,
  connectionHistory: (params: ConnectionHistoryParams) =>
    [...runnerKeys.all, "connection-history", params] as const,
  tokenConnections: (tokenId: string, params: ConnectionHistoryParams) =>
    [...runnerKeys.all, "token-connections", tokenId, params] as const,
};

/**
 * Fetch all runner tokens
 */
export function useRunnerTokens() {
  return useQuery<RunnerToken[], Error>({
    queryKey: runnerKeys.tokens(),
    queryFn: () => runnerService.listTokens(),
    retry: 1, // Only retry once on failure
    retryDelay: 1000,
  });
}

/**
 * Fetch a single runner token by ID
 */
export function useRunnerToken(tokenId: string) {
  return useQuery<RunnerToken, Error>({
    queryKey: runnerKeys.token(tokenId),
    queryFn: () => runnerService.getToken(tokenId),
    enabled: !!tokenId,
  });
}

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
    retry: 1, // Only retry once on failure
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
 * Fetch connections for a specific token
 */
export function useTokenConnections(
  tokenId: string,
  params: ConnectionHistoryParams = {}
) {
  return useQuery<ConnectionHistoryResponse, Error>({
    queryKey: runnerKeys.tokenConnections(tokenId, params),
    queryFn: () => runnerService.getTokenConnections(tokenId, params),
    enabled: !!tokenId,
  });
}

/**
 * Create a new runner token
 */
export function useCreateRunnerToken() {
  const queryClient = useQueryClient();

  return useMutation<
    RunnerTokenWithSecret,
    Error,
    { name: string; expiresInDays?: number | null }
  >({
    mutationFn: ({ name, expiresInDays }) =>
      runnerService.createToken(name, expiresInDays),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runnerKeys.tokens() });
      toast.success("Runner token created successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create runner token");
    },
  });
}

/**
 * Revoke a runner token
 */
export function useRevokeRunnerToken() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (tokenId: string) => runnerService.revokeToken(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runnerKeys.tokens() });
      queryClient.invalidateQueries({
        queryKey: runnerKeys.activeConnections(),
      });
      toast.success("Runner token revoked successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to revoke runner token");
    },
  });
}

/**
 * Delete a runner token
 */
export function useDeleteRunnerToken() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (tokenId: string) => runnerService.deleteToken(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runnerKeys.tokens() });
      toast.success("Runner token deleted successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete runner token");
    },
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
