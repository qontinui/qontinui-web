import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";

/**
 * Hook to access real-time runner connection data.
 *
 * Uses a shared context provider (RealtimeConnectionsProvider) so only ONE
 * WebSocket connection is maintained regardless of how many components
 * consume this hook. Falls back to polling if WebSocket connection fails.
 */
export function useRealtimeConnections() {
  return useRealtimeConnectionsContext();
}
