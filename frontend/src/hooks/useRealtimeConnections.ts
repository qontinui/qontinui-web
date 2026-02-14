import { useState, useEffect, useRef, useCallback } from "react";
import { RunnerConnection } from "@/types/runner";
import { runnerService } from "@/services/service-factory";

/**
 * Hook to manage real-time runner connection updates via WebSocket.
 *
 * Connects to the backend WebSocket endpoint to receive live updates
 * when runners connect or disconnect, eliminating the need for polling.
 *
 * Falls back to polling if WebSocket connection fails.
 */
export function useRealtimeConnections() {
  const [connections, setConnections] = useState<RunnerConnection[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  // Fetch connections via REST API (used for initial load and fallback)
  const fetchConnections = useCallback(async () => {
    try {
      const data = await runnerService.getActiveConnections();
      setConnections(data);
      setIsLoading(false);
      return data;
    } catch (error) {
      console.error(
        "[useRealtimeConnections] Failed to fetch connections:",
        error
      );
      setIsLoading(false);
      return [];
    }
  }, []);

  // Start polling as fallback
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(() => {
      if (!document.hidden) {
        fetchConnections();
      }
    }, 30000);
  }, [fetchConnections]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connectWebSocket = useCallback(async () => {
    // Get access token from the ws-token API route (reads HttpOnly cookie server-side)
    let token: string | null = null;
    try {
      const response = await fetch("/api/v1/ws-token", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        token = data.token || null;
      }
    } catch (error) {
      console.error(
        "[useRealtimeConnections] Failed to get WebSocket token:",
        error
      );
    }

    if (!token) {
      console.warn(
        "[useRealtimeConnections] No access token found, using polling"
      );
      fetchConnections();
      startPolling();
      return;
    }

    // Build WebSocket URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
    const apiHost = apiUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${apiHost}/api/v1/ws/runner/status?token=${encodeURIComponent(token)}`;

    console.debug("[useRealtimeConnections] Connecting to WebSocket");

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        stopPolling(); // Stop polling when WebSocket connects
      };

      ws.onclose = (event) => {
        console.debug("[useRealtimeConnections] WebSocket closed:", event.code);
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          console.debug(`[useRealtimeConnections] Reconnecting in ${delay}ms`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWebSocket();
          }, delay);
        } else {
          // Max reconnect attempts reached, fallback to polling
          console.debug(
            "[useRealtimeConnections] Max reconnects reached, polling"
          );
          startPolling();
        }
      };

      ws.onerror = (error) => {
        console.error("[useRealtimeConnections] WebSocket error:", error);
        setIsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "initial_state") {
            // Set initial connections
            setConnections(message.connections);
            setIsLoading(false);
          } else if (message.type === "runner_connected") {
            // Add new connection
            if (message.connection) {
              setConnections((prev) => {
                // Check if connection already exists
                const exists = prev.some((c) => c.id === message.connection.id);
                if (exists) {
                  return prev;
                }
                return [...prev, message.connection];
              });
            }
          } else if (message.type === "runner_disconnected") {
            // Remove disconnected connection
            setConnections((prev) =>
              prev.filter((c) => c.id !== message.connection_id)
            );
          } else if (message.type === "error") {
            console.error(
              "[useRealtimeConnections] Server error:",
              message.error
            );
          }
        } catch (error) {
          console.error(
            "[useRealtimeConnections] Failed to parse message:",
            error
          );
        }
      };
    } catch (error) {
      console.error(
        "[useRealtimeConnections] Failed to create WebSocket:",
        error
      );
      // Fallback to polling
      fetchConnections();
      startPolling();
    }
  }, [fetchConnections, startPolling, stopPolling]);

  // Initial connection
  useEffect(() => {
    // Fetch initial data
    fetchConnections();

    // Try to connect via WebSocket
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      stopPolling();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket, fetchConnections, stopPolling]);

  return {
    connections,
    isConnected,
    isLoading,
    // Expose refetch for manual refresh
    refetch: fetchConnections,
  };
}
