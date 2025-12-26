/**
 * WebSocket hook for real-time execution events from qontinui-runner
 *
 * Connects to the runner's WebSocket endpoint to receive live updates
 * during automation execution including:
 * - Image recognition results with found coordinates
 * - Tree events (state activation/deactivation)
 *
 * This enables the Live Perception Canvas to display what the automation
 * "sees" during real execution.
 */

import { useEffect, useState, useRef, useCallback } from "react";

// Default runner URL - can be overridden via environment variable
const RUNNER_BASE_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";

/**
 * Image recognition result from the runner
 * Contains the found coordinates of StateImages on screen
 */
export interface ImageRecognitionEvent {
  imageId: string;
  stateId: string;
  patternId: string;
  found: boolean;
  /** X coordinate where the image was found on screen */
  x?: number;
  /** Y coordinate where the image was found on screen */
  y?: number;
  /** Width of the matched region */
  width?: number;
  /** Height of the matched region */
  height?: number;
  /** Confidence score of the match */
  confidence?: number;
  /** Timestamp of the recognition */
  timestamp: number;
}

/**
 * Tree event for state activation/deactivation
 */
export interface TreeEvent {
  event_type: "node_activated" | "node_deactivated" | "transition_complete";
  nodeId: string;
  stateId?: string;
  path?: string[];
  timestamp: number;
  sequence: number;
}

/**
 * Connection state for the WebSocket
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Live execution state from the runner
 */
export interface ExecutionEventsState {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Set of currently active state IDs */
  activeStateIds: Set<string>;
  /** Map of image recognitions by imageId - latest found coordinates */
  imageRecognitions: Map<string, ImageRecognitionEvent>;
  /** All tree events received (for debugging/replay) */
  treeEvents: TreeEvent[];
  /** Last error message if any */
  lastError: string | null;
  /** Time of last received event */
  lastEventTime: Date | null;
}

export interface UseExecutionEventsOptions {
  /** Enable/disable the WebSocket connection */
  enabled?: boolean;
  /** Custom runner URL (overrides default) */
  runnerUrl?: string;
  /** Callback when connection is established */
  onConnect?: () => void;
  /** Callback when connection is lost */
  onDisconnect?: () => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Callback when an image recognition event is received */
  onImageRecognition?: (event: ImageRecognitionEvent) => void;
  /** Callback when a tree event is received */
  onTreeEvent?: (event: TreeEvent) => void;
}

/**
 * Hook for receiving real-time execution events from qontinui-runner
 */
export function useExecutionEvents(options: UseExecutionEventsOptions = {}) {
  const {
    enabled = true,
    runnerUrl = RUNNER_BASE_URL,
    onConnect,
    onDisconnect,
    onError,
    onImageRecognition,
    onTreeEvent,
  } = options;

  const [state, setState] = useState<ExecutionEventsState>({
    connectionState: "disconnected",
    activeStateIds: new Set(),
    imageRecognitions: new Map(),
    treeEvents: [],
    lastError: null,
    lastEventTime: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);

  /**
   * Parse and handle incoming WebSocket messages
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // Handle image recognition events
        if (data.event === "image_recognition") {
          const recognitionData = data.data;
          const imageEvent: ImageRecognitionEvent = {
            imageId: recognitionData.image_id || recognitionData.imageId,
            stateId: recognitionData.state_id || recognitionData.stateId,
            patternId: recognitionData.pattern_id || recognitionData.patternId,
            found: recognitionData.found ?? true,
            x: recognitionData.x ?? recognitionData.found_x,
            y: recognitionData.y ?? recognitionData.found_y,
            width: recognitionData.width,
            height: recognitionData.height,
            confidence: recognitionData.confidence,
            timestamp: recognitionData.timestamp || Date.now(),
          };

          setState((prev) => {
            const newRecognitions = new Map(prev.imageRecognitions);
            if (imageEvent.found && imageEvent.x !== undefined) {
              newRecognitions.set(imageEvent.imageId, imageEvent);
            } else {
              // Remove from map if not found
              newRecognitions.delete(imageEvent.imageId);
            }

            // Also update active states if stateId is provided
            const newActiveStates = new Set(prev.activeStateIds);
            if (imageEvent.found && imageEvent.stateId) {
              newActiveStates.add(imageEvent.stateId);
            }

            return {
              ...prev,
              imageRecognitions: newRecognitions,
              activeStateIds: newActiveStates,
              lastEventTime: new Date(),
            };
          });

          if (onImageRecognition) {
            onImageRecognition(imageEvent);
          }
        }

        // Handle tree events (state activation/deactivation)
        if (data.type === "tree_event") {
          const treeEvent: TreeEvent = {
            event_type: data.event_type,
            nodeId: data.node?.id || data.nodeId,
            stateId: data.node?.state_id || data.stateId,
            path: data.path,
            timestamp: data.timestamp || Date.now(),
            sequence: data.sequence || 0,
          };

          setState((prev) => {
            const newActiveStates = new Set(prev.activeStateIds);
            const stateId = treeEvent.stateId || treeEvent.nodeId;

            if (treeEvent.event_type === "node_activated" && stateId) {
              newActiveStates.add(stateId);
            } else if (treeEvent.event_type === "node_deactivated" && stateId) {
              newActiveStates.delete(stateId);
            }

            return {
              ...prev,
              activeStateIds: newActiveStates,
              treeEvents: [...prev.treeEvents, treeEvent].slice(-100), // Keep last 100 events
              lastEventTime: new Date(),
            };
          });

          if (onTreeEvent) {
            onTreeEvent(treeEvent);
          }
        }
      } catch (error) {
        console.error("[useExecutionEvents] Failed to parse message:", error);
      }
    },
    [onImageRecognition, onTreeEvent]
  );

  /**
   * Start heartbeat to keep connection alive
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }

    heartbeatInterval.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "ping" }));
        } catch (error) {
          console.error(
            "[useExecutionEvents] Failed to send heartbeat:",
            error
          );
        }
      }
    }, 30000); // Every 30 seconds
  }, []);

  /**
   * Stop heartbeat
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = null;
    }
  }, []);

  /**
   * Connect to the runner WebSocket
   */
  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.warn("[useExecutionEvents] Already connected");
      return;
    }

    try {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = runnerUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:");
      const fullWsUrl = `${wsUrl}/ws/events`;

      console.log("[useExecutionEvents] Connecting to:", fullWsUrl);
      setState((prev) => ({ ...prev, connectionState: "connecting" }));

      wsRef.current = new WebSocket(fullWsUrl);

      wsRef.current.onopen = () => {
        console.log("[useExecutionEvents] Connected");
        reconnectAttempts.current = 0;
        setState((prev) => ({
          ...prev,
          connectionState: "connected",
          lastError: null,
        }));

        startHeartbeat();

        if (onConnect) {
          onConnect();
        }
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onerror = (event) => {
        console.error("[useExecutionEvents] WebSocket error:", event);
        setState((prev) => ({
          ...prev,
          connectionState: "error",
          lastError: "WebSocket connection error",
        }));

        if (onError) {
          onError(new Error("WebSocket connection error"));
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(
          "[useExecutionEvents] Disconnected:",
          event.code,
          event.reason
        );
        stopHeartbeat();

        const wasNormalClosure = event.code === 1000;
        const shouldReconnect =
          enabled &&
          reconnectAttempts.current < maxReconnectAttempts &&
          !wasNormalClosure;

        setState((prev) => ({
          ...prev,
          connectionState: shouldReconnect ? "reconnecting" : "disconnected",
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
            `[useExecutionEvents] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`
          );

          reconnectTimeout.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (error) {
      console.error("[useExecutionEvents] Failed to create WebSocket:", error);
      setState((prev) => ({
        ...prev,
        connectionState: "error",
        lastError: error instanceof Error ? error.message : "Connection failed",
      }));

      if (onError) {
        onError(
          error instanceof Error ? error : new Error("Connection failed")
        );
      }
    }
  }, [
    enabled,
    runnerUrl,
    handleMessage,
    onConnect,
    onDisconnect,
    onError,
    startHeartbeat,
    stopHeartbeat,
  ]);

  /**
   * Disconnect from the WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    stopHeartbeat();

    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      connectionState: "disconnected",
    }));
  }, [stopHeartbeat]);

  /**
   * Clear all tracked state (useful when starting a new execution)
   */
  const clearState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      activeStateIds: new Set(),
      imageRecognitions: new Map(),
      treeEvents: [],
      lastEventTime: null,
    }));
  }, []);

  /**
   * Connect on mount when enabled
   */
  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, runnerUrl]);

  return {
    ...state,
    isConnected: state.connectionState === "connected",
    reconnectAttempt: reconnectAttempts.current,
    maxReconnectAttempts,
    connect,
    disconnect,
    clearState,
  };
}
