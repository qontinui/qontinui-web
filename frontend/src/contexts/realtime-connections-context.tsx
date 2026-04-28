"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import type { Runner } from "@qontinui/shared-types";
import { runnerService } from "@/services/service-factory";
import { createLogger } from "@/lib/logger";

const log = createLogger("RealtimeConnections");

// ============================================================================
// Context Types
// ============================================================================

interface RealtimeConnectionsContextValue {
  /**
   * Runners that are reachable right now — derivedStatus is one of
   * `healthy`, `degraded`, or `starting`. Backed by `GET /api/v1/runners`
   * (status filter) plus the `/runners/status` WebSocket push channel.
   */
  runners: Runner[];
  isConnected: boolean;
  isLoading: boolean;
  refetch: () => Promise<Runner[]>;
}

const RealtimeConnectionsContext = createContext<
  RealtimeConnectionsContextValue | undefined
>(undefined);

// ============================================================================
// WebSocket message shapes
// ============================================================================

type WsMessage =
  | { type: "initial_state"; runners: Runner[] }
  | { type: "runner_connected"; runner: Runner }
  | { type: "runner_disconnected"; runner_id: string }
  | { type: "runner_updated"; runner: Runner }
  | { type: "error"; error: string };

// ============================================================================
// Provider
// ============================================================================

const MAX_RECONNECT_ATTEMPTS = 5;
const POLLING_INTERVAL_MS = 30000;
/** Status filter for "online" runners — anything actively reachable. */
const ONLINE_STATUS_FILTER = "healthy,degraded,starting";

export function RealtimeConnectionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const cleanedUpRef = useRef(false);

  // Fetch runners via REST API (used for initial load and polling fallback)
  const fetchRunners = useCallback(async () => {
    try {
      const data = await runnerService.getRunners(ONLINE_STATUS_FILTER);
      setRunners(data);
      setIsLoading(false);
      return data;
    } catch (error) {
      console.error("[RealtimeConnections] Failed to fetch runners:", error);
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
        fetchRunners();
      }
    }, POLLING_INTERVAL_MS);
  }, [fetchRunners]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Close WebSocket connection
  const closeWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Clear pending reconnect
  const clearReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connectWebSocket = useCallback(async () => {
    // Don't reconnect if cleaned up
    if (cleanedUpRef.current) return;

    // Don't connect if tab is hidden
    if (document.hidden) return;

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
        "[RealtimeConnections] Failed to get WebSocket token:",
        error
      );
    }

    // Bail if cleaned up during async token fetch
    if (cleanedUpRef.current) return;

    if (!token) {
      console.warn(
        "[RealtimeConnections] No access token found, using polling"
      );
      fetchRunners();
      startPolling();
      return;
    }

    // Build WebSocket URL — Phase 2 path: /api/v1/runners/status
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
    const apiHost = apiUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${apiHost}/api/v1/runners/status?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cleanedUpRef.current) {
          ws.close();
          return;
        }
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        stopPolling();
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        // Don't reconnect if cleaned up or tab hidden
        if (cleanedUpRef.current || document.hidden) return;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWebSocket();
          }, delay);
        } else {
          // Max reconnect attempts reached, fallback to polling
          log.debug("Max reconnects reached, polling");
          startPolling();
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage;

          if (message.type === "initial_state") {
            setRunners(message.runners);
            setIsLoading(false);
          } else if (message.type === "runner_connected") {
            setRunners((prev) => {
              const exists = prev.some((r) => r.id === message.runner.id);
              if (exists) {
                // Replace with the latest snapshot.
                return prev.map((r) =>
                  r.id === message.runner.id ? message.runner : r
                );
              }
              return [...prev, message.runner];
            });
          } else if (message.type === "runner_disconnected") {
            setRunners((prev) =>
              prev.filter((r) => r.id !== message.runner_id)
            );
          } else if (message.type === "runner_updated") {
            setRunners((prev) =>
              prev.map((r) =>
                r.id === message.runner.id ? { ...r, ...message.runner } : r
              )
            );
          } else if (message.type === "error") {
            console.error("[RealtimeConnections] Server error:", message.error);
          }
        } catch (error) {
          console.error(
            "[RealtimeConnections] Failed to parse message:",
            error
          );
        }
      };
    } catch (error) {
      console.error("[RealtimeConnections] Failed to create WebSocket:", error);
      fetchRunners();
      startPolling();
    }
  }, [fetchRunners, startPolling, stopPolling]);

  // Handle visibility changes: disconnect when hidden, reconnect when visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden: close WebSocket and stop polling to save resources
        clearReconnect();
        closeWebSocket();
        stopPolling();
        setIsConnected(false);
      } else {
        // Tab visible: reconnect
        reconnectAttemptsRef.current = 0;
        fetchRunners();
        connectWebSocket();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [
    clearReconnect,
    closeWebSocket,
    stopPolling,
    fetchRunners,
    connectWebSocket,
  ]);

  // Initial connection
  useEffect(() => {
    cleanedUpRef.current = false;

    fetchRunners();
    connectWebSocket();

    return () => {
      cleanedUpRef.current = true;
      closeWebSocket();
      stopPolling();
      clearReconnect();
    };
  }, [
    fetchRunners,
    connectWebSocket,
    closeWebSocket,
    stopPolling,
    clearReconnect,
  ]);

  const value: RealtimeConnectionsContextValue = {
    runners,
    isConnected,
    isLoading,
    refetch: fetchRunners,
  };

  return (
    <RealtimeConnectionsContext.Provider value={value}>
      {children}
    </RealtimeConnectionsContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useRealtimeConnectionsContext() {
  const context = useContext(RealtimeConnectionsContext);
  if (context === undefined) {
    throw new Error(
      "useRealtimeConnectionsContext must be used within a RealtimeConnectionsProvider"
    );
  }
  return context;
}
