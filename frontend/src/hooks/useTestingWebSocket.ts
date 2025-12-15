/**
 * WebSocket hook for real-time test execution updates
 *
 * Connects to the backend WebSocket endpoint to receive live updates
 * during test execution including transition results and screenshots.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { TransitionResult } from "@/services/testing-service";

export type TestExecutionState =
  | "idle"
  | "connecting"
  | "running"
  | "completed"
  | "failed"
  | "disconnected"
  | "reconnecting";

export interface TestExecutionUpdate {
  type:
    | "test_start"
    | "transition_start"
    | "transition_complete"
    | "transition_failed"
    | "test_complete"
    | "test_failed"
    | "pong";
  test_run_id: string;
  timestamp: string;
  data?: unknown;
}

export interface TransitionUpdate extends TransitionResult {
  status: "pending" | "running" | "completed" | "failed";
}

export interface LiveTestExecutionData {
  testRunId: string | null;
  state: TestExecutionState;
  currentState: string | null;
  currentAction: string | null;
  elapsedTime: number;
  transitions: TransitionUpdate[];
  totalTransitions: number;
  successfulTransitions: number;
  failedTransitions: number;
  lastUpdate: Date | null;
}

export interface UseTestingWebSocketOptions {
  testRunId?: string;
  enabled?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onTransitionComplete?: (transition: TransitionUpdate) => void;
  onTestComplete?: (data: { success: boolean; duration: number }) => void;
}

/**
 * WebSocket hook for real-time test execution updates
 */
export function useTestingWebSocket(options: UseTestingWebSocketOptions = {}) {
  const {
    testRunId,
    enabled = true,
    onConnect,
    onDisconnect,
    onError,
    onTransitionComplete,
    onTestComplete,
  } = options;

  const [executionData, setExecutionData] = useState<LiveTestExecutionData>({
    testRunId: null,
    state: "idle",
    currentState: null,
    currentAction: null,
    elapsedTime: 0,
    transitions: [],
    totalTransitions: 0,
    successfulTransitions: 0,
    failedTransitions: 0,
    lastUpdate: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const messageQueue = useRef<string[]>([]);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastHeartbeatRef = useRef<Date | null>(null);

  /**
   * Update elapsed time every second
   */
  const startElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
    }

    startTimeRef.current = new Date();

    elapsedTimerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Math.floor(
          (new Date().getTime() - startTimeRef.current.getTime()) / 1000
        );
        setExecutionData((prev) => ({ ...prev, elapsedTime: elapsed }));
      }
    }, 1000);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  /**
   * Send queued messages after reconnection
   */
  const flushMessageQueue = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    while (messageQueue.current.length > 0) {
      const message = messageQueue.current.shift();
      if (message) {
        try {
          wsRef.current.send(message);
          console.log("[useTestingWebSocket] Sent queued message");
        } catch (error) {
          console.error(
            "[useTestingWebSocket] Failed to send queued message:",
            error
          );
          messageQueue.current.unshift(message);
          break;
        }
      }
    }
  }, []);

  /**
   * Start heartbeat monitoring
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    lastHeartbeatRef.current = new Date();

    heartbeatIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      const now = new Date();
      const lastHeartbeat = lastHeartbeatRef.current;

      if (lastHeartbeat) {
        const timeSinceLastHeartbeat = now.getTime() - lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > 60000) {
          console.warn(
            "[useTestingWebSocket] No heartbeat for 60s, connection may be stale"
          );
          if (wsRef.current) {
            wsRef.current.close();
          }
        }
      }

      try {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      } catch (error) {
        console.error("[useTestingWebSocket] Failed to send ping:", error);
      }
    }, 30000);
  }, []);

  /**
   * Stop heartbeat monitoring
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: TestExecutionUpdate = JSON.parse(event.data);

        // Handle heartbeat
        if (message.type === "pong") {
          lastHeartbeatRef.current = new Date();
          return;
        }

        setExecutionData((prev) => {
          const updated = { ...prev, lastUpdate: new Date() };

          switch (message.type) {
            case "test_start": {
              const data = message.data as { total_transitions?: number };
              startElapsedTimer();
              return {
                ...updated,
                testRunId: message.test_run_id,
                state: "running",
                totalTransitions: data?.total_transitions || 0,
                transitions: [],
                successfulTransitions: 0,
                failedTransitions: 0,
                elapsedTime: 0,
              };
            }

            case "transition_start": {
              const data = message.data as {
                from_state: string;
                to_state: string;
                action_type: string;
                transition_id: string;
              };

              const newTransition: TransitionUpdate = {
                id: data.transition_id,
                test_run_id: message.test_run_id,
                from_state: data.from_state,
                to_state: data.to_state,
                action_type: data.action_type,
                success: false,
                duration_ms: 0,
                error_message: null,
                screenshot_url: null,
                executed_at: message.timestamp,
                status: "running",
              };

              return {
                ...updated,
                currentState: data.from_state,
                currentAction: data.action_type,
                transitions: [...prev.transitions, newTransition],
              };
            }

            case "transition_complete": {
              const data = message.data as {
                transition_id: string;
                duration_ms: number;
                screenshot_url?: string;
                to_state: string;
              };

              const updatedTransitions = prev.transitions.map((t) =>
                t.id === data.transition_id
                  ? {
                      ...t,
                      success: true,
                      duration_ms: data.duration_ms,
                      screenshot_url: data.screenshot_url || null,
                      status: "completed" as const,
                    }
                  : t
              );

              const completedTransition = updatedTransitions.find(
                (t) => t.id === data.transition_id
              );

              if (completedTransition && onTransitionComplete) {
                onTransitionComplete(completedTransition);
              }

              return {
                ...updated,
                transitions: updatedTransitions,
                successfulTransitions: prev.successfulTransitions + 1,
                currentState: data.to_state,
              };
            }

            case "transition_failed": {
              const data = message.data as {
                transition_id: string;
                duration_ms: number;
                error_message: string;
                screenshot_url?: string;
              };

              const updatedTransitions = prev.transitions.map((t) =>
                t.id === data.transition_id
                  ? {
                      ...t,
                      success: false,
                      duration_ms: data.duration_ms,
                      error_message: data.error_message,
                      screenshot_url: data.screenshot_url || null,
                      status: "failed" as const,
                    }
                  : t
              );

              return {
                ...updated,
                transitions: updatedTransitions,
                failedTransitions: prev.failedTransitions + 1,
              };
            }

            case "test_complete": {
              const data = message.data as {
                success: boolean;
                duration: number;
              };
              stopElapsedTimer();

              if (onTestComplete) {
                onTestComplete(data);
              }

              return {
                ...updated,
                state: "completed",
                currentState: null,
                currentAction: null,
              };
            }

            case "test_failed": {
              stopElapsedTimer();

              return {
                ...updated,
                state: "failed",
                currentState: null,
                currentAction: null,
              };
            }

            default:
              console.warn(
                "[useTestingWebSocket] Unknown message type:",
                message.type
              );
              return updated;
          }
        });
      } catch (error) {
        console.error("[useTestingWebSocket] Failed to parse message:", error);
        if (onError) {
          onError(error as Error);
        }
      }
    },
    [
      onTransitionComplete,
      onTestComplete,
      onError,
      startElapsedTimer,
      stopElapsedTimer,
    ]
  );

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!enabled || !testRunId) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.warn("[useTestingWebSocket] Already connected");
      return;
    }

    try {
      // Determine WebSocket URL based on environment
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/v1/testing/runs/${testRunId}/stream`;

      console.log("[useTestingWebSocket] Connecting to:", wsUrl);

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log("[useTestingWebSocket] Connected");
        reconnectAttempts.current = 0;
        setExecutionData((prev) => ({ ...prev, state: "connecting" }));

        startHeartbeat();
        flushMessageQueue();

        if (onConnect) {
          onConnect();
        }
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onerror = (event) => {
        console.error("[useTestingWebSocket] Error:", event);
        if (onError) {
          onError(new Error("WebSocket error"));
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(
          "[useTestingWebSocket] Disconnected:",
          event.code,
          event.reason
        );
        stopElapsedTimer();
        stopHeartbeat();

        const wasNormalClosure = event.code === 1000;
        const shouldReconnect =
          enabled &&
          reconnectAttempts.current < maxReconnectAttempts &&
          !wasNormalClosure;

        setExecutionData((prev) => ({
          ...prev,
          state: shouldReconnect ? "reconnecting" : "disconnected",
        }));

        if (onDisconnect) {
          onDisconnect();
        }

        if (shouldReconnect) {
          reconnectAttempts.current++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.current - 1),
            30000
          );

          console.log(
            `[useTestingWebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`
          );

          reconnectTimeout.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (
          reconnectAttempts.current >= maxReconnectAttempts &&
          !wasNormalClosure
        ) {
          console.error("[useTestingWebSocket] Max reconnect attempts reached");
          messageQueue.current = [];
          if (onError) {
            onError(
              new Error("Connection lost after maximum reconnection attempts")
            );
          }
        }
      };
    } catch (error) {
      console.error("[useTestingWebSocket] Failed to create WebSocket:", error);
      if (onError) {
        onError(error as Error);
      }
    }
  }, [
    enabled,
    testRunId,
    handleMessage,
    onConnect,
    onDisconnect,
    onError,
    stopElapsedTimer,
    stopHeartbeat,
    startHeartbeat,
    flushMessageQueue,
  ]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    stopElapsedTimer();
    stopHeartbeat();
    messageQueue.current = [];

    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }

    setExecutionData((prev) => ({ ...prev, state: "idle" }));
  }, [stopElapsedTimer, stopHeartbeat]);

  /**
   * Connect on mount/when testRunId changes
   */
  useEffect(() => {
    if (enabled && testRunId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, testRunId, connect, disconnect]);

  return {
    ...executionData,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnectAttempt: reconnectAttempts.current,
    maxReconnectAttempts,
    queuedMessages: messageQueue.current.length,
    connect,
    disconnect,
  };
}
