import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";

/**
 * Hook to access real-time runner data.
 *
 * Uses a shared context provider (RealtimeConnectionsProvider) so only ONE
 * WebSocket connection is maintained regardless of how many components
 * consume this hook. Falls back to polling if WebSocket connection fails.
 *
 * Returns runners with derivedStatus in {`healthy`, `degraded`, `starting`}
 * — i.e. anything reachable. Filter further at the call site if needed.
 */
export function useRealtimeConnections() {
  return useRealtimeConnectionsContext();
}
