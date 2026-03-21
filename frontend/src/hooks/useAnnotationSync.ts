/**
 * useAnnotationSync Hook
 *
 * React hook for real-time annotation collaboration via WebSocket.
 * Provides:
 * - WebSocket connection management
 * - Cursor position synchronization
 * - Element selection broadcasting
 * - Real-time element updates (add, update, delete, move, resize)
 * - User presence tracking
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { createLogger } from "@/lib/logger";

const log = createLogger("useAnnotationSync");
import type {
  AnnotatedElement,
  BoundingBox,
} from "@/stores/extraction-annotation-store";

// ============================================================================
// Types
// ============================================================================

export interface Collaborator {
  id: string;
  name: string;
  email: string;
  color: string;
  cursor: { x: number; y: number; viewport_id?: string } | null;
  selection: string[];
  connected_at: string;
}

export interface CursorUpdate {
  user_id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  viewport_id?: string;
}

export interface SelectionUpdate {
  user_id: string;
  name: string;
  color: string;
  element_ids: string[];
}

export interface ElementUpdate {
  user_id: string;
  element_id: string;
  changes: Partial<AnnotatedElement>;
}

export interface ElementAddUpdate {
  user_id: string;
  element: AnnotatedElement;
}

export interface ElementDeleteUpdate {
  user_id: string;
  element_ids: string[];
}

export interface ElementMoveUpdate {
  user_id: string;
  element_ids: string[];
  delta_x: number;
  delta_y: number;
}

export interface ElementResizeUpdate {
  user_id: string;
  element_id: string;
  bbox: BoundingBox;
}

export interface UseAnnotationSyncReturn {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;

  // Collaborators
  collaborators: Collaborator[];
  myColor: string | null;

  // Methods for sending updates
  sendCursorMove: (x: number, y: number, viewportId?: string) => void;
  sendElementSelect: (elementIds: string[]) => void;
  sendElementUpdate: (
    elementId: string,
    changes: Partial<AnnotatedElement>
  ) => void;
  sendElementAdd: (element: AnnotatedElement) => void;
  sendElementDelete: (elementIds: string[]) => void;
  sendElementMove: (
    elementIds: string[],
    deltaX: number,
    deltaY: number
  ) => void;
  sendElementResize: (elementId: string, bbox: BoundingBox) => void;

  // Connection management
  connect: () => void;
  disconnect: () => void;
}

export interface UseAnnotationSyncOptions {
  /** Called when a remote user moves their cursor */
  onCursorMove?: (update: CursorUpdate) => void;
  /** Called when a remote user changes their selection */
  onElementSelect?: (update: SelectionUpdate) => void;
  /** Called when a remote user updates an element */
  onElementUpdate?: (update: ElementUpdate) => void;
  /** Called when a remote user adds an element */
  onElementAdd?: (update: ElementAddUpdate) => void;
  /** Called when a remote user deletes elements */
  onElementDelete?: (update: ElementDeleteUpdate) => void;
  /** Called when a remote user moves elements */
  onElementMove?: (update: ElementMoveUpdate) => void;
  /** Called when a remote user resizes an element */
  onElementResize?: (update: ElementResizeUpdate) => void;
  /** Called when the collaborators list changes */
  onCollaboratorsChange?: (collaborators: Collaborator[]) => void;
  /** Auto-connect when hook mounts */
  autoConnect?: boolean;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

interface WSMessage {
  type: string;
  data?: unknown;
  timestamp?: string;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAnnotationSync(
  annotationSetId: string | null,
  options: UseAnnotationSyncOptions = {}
): UseAnnotationSyncReturn {
  const { getAccessToken } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [myColor, setMyColor] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const optionsRef = useRef(options);

  // Keep options ref up to date
  optionsRef.current = options;

  /**
   * Build WebSocket URL (async - needs to fetch token)
   */
  const getWebSocketUrl = useCallback(async (): Promise<string | null> => {
    if (!annotationSetId) return null;

    const token = await getAccessToken();
    if (!token) return null;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/api/v1/ws/annotations/${annotationSetId}?token=${token}`;
  }, [annotationSetId, getAccessToken]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WSMessage = JSON.parse(event.data);

      switch (message.type) {
        case "connected": {
          const data = message.data as { color?: string };
          if (data.color) {
            setMyColor(data.color);
          }
          break;
        }

        case "active_users": {
          const data = message.data as { users: Collaborator[] };
          setCollaborators(data.users);
          optionsRef.current.onCollaboratorsChange?.(data.users);
          break;
        }

        case "user_join": {
          const newUser = message.data as Collaborator;
          setCollaborators((prev) => {
            // Avoid duplicates
            if (prev.some((u) => u.id === newUser.id)) {
              return prev;
            }
            const updated = [...prev, newUser];
            optionsRef.current.onCollaboratorsChange?.(updated);
            return updated;
          });
          break;
        }

        case "user_leave": {
          const data = message.data as { id: string };
          setCollaborators((prev) => {
            const updated = prev.filter((u) => u.id !== data.id);
            optionsRef.current.onCollaboratorsChange?.(updated);
            return updated;
          });
          break;
        }

        case "cursor_move": {
          const cursorUpdate = message.data as CursorUpdate;
          // Update collaborator cursor position
          setCollaborators((prev) =>
            prev.map((c) =>
              c.id === cursorUpdate.user_id
                ? {
                    ...c,
                    cursor: {
                      x: cursorUpdate.x,
                      y: cursorUpdate.y,
                      viewport_id: cursorUpdate.viewport_id,
                    },
                  }
                : c
            )
          );
          optionsRef.current.onCursorMove?.(cursorUpdate);
          break;
        }

        case "element_select": {
          const selectUpdate = message.data as SelectionUpdate;
          // Update collaborator selection
          setCollaborators((prev) =>
            prev.map((c) =>
              c.id === selectUpdate.user_id
                ? { ...c, selection: selectUpdate.element_ids }
                : c
            )
          );
          optionsRef.current.onElementSelect?.(selectUpdate);
          break;
        }

        case "element_update": {
          const updateData = message.data as ElementUpdate;
          optionsRef.current.onElementUpdate?.(updateData);
          break;
        }

        case "element_add": {
          const addData = message.data as ElementAddUpdate;
          optionsRef.current.onElementAdd?.(addData);
          break;
        }

        case "element_delete": {
          const deleteData = message.data as ElementDeleteUpdate;
          optionsRef.current.onElementDelete?.(deleteData);
          break;
        }

        case "element_move": {
          const moveData = message.data as ElementMoveUpdate;
          optionsRef.current.onElementMove?.(moveData);
          break;
        }

        case "element_resize": {
          const resizeData = message.data as ElementResizeUpdate;
          optionsRef.current.onElementResize?.(resizeData);
          break;
        }

        case "sync_response": {
          const data = message.data as { users: Collaborator[] };
          setCollaborators(data.users);
          optionsRef.current.onCollaboratorsChange?.(data.users);
          break;
        }

        case "heartbeat_ack":
        case "pong":
          // Heartbeat acknowledged
          break;

        case "error": {
          const errorMessage = (message as { message?: string }).message;
          console.error("[AnnotationSync] Server error:", errorMessage);
          break;
        }

        default:
          console.warn("[AnnotationSync] Unknown message type:", message.type);
      }
    } catch (err) {
      console.error("[AnnotationSync] Failed to parse message:", err);
    }
  }, []);

  /**
   * Start heartbeat interval
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 30000);
  }, []);

  /**
   * Stop heartbeat interval
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(async () => {
    // Don't reconnect if already connected/connecting
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const url = await getWebSocketUrl();
      if (!url) {
        setError(
          new Error("Cannot connect: missing annotation set ID or token")
        );
        setIsConnecting(false);
        return;
      }

      const ws = new WebSocket(url);

      ws.onopen = () => {
        log.debug("Connected");
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        startHeartbeat();
      };

      ws.onclose = (event) => {
        log.debug("Disconnected", event.code, event.reason);
        setIsConnected(false);
        setIsConnecting(false);
        stopHeartbeat();

        // Attempt reconnection if not intentionally closed
        if (event.code !== 1000 && annotationSetId) {
          reconnectTimeoutRef.current = setTimeout(() => {
            log.debug("Attempting reconnection...");
            connect();
          }, 3000);
        }
      };

      ws.onerror = (event) => {
        console.error("[AnnotationSync] WebSocket error:", event);
        setError(new Error("WebSocket connection error"));
      };

      ws.onmessage = handleMessage;

      wsRef.current = ws;
    } catch (err) {
      console.error("[AnnotationSync] Failed to create WebSocket:", err);
      setError(err instanceof Error ? err : new Error("Failed to connect"));
      setIsConnecting(false);
    }
  }, [
    getWebSocketUrl,
    handleMessage,
    startHeartbeat,
    stopHeartbeat,
    annotationSetId,
  ]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    // Clear reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopHeartbeat();

    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnected");
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setCollaborators([]);
    setMyColor(null);
  }, [stopHeartbeat]);

  /**
   * Send a message to the WebSocket server
   */
  const send = useCallback((type: string, data: unknown) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn("[AnnotationSync] Cannot send: not connected");
      return;
    }

    wsRef.current.send(JSON.stringify({ type, data }));
  }, []);

  /**
   * Send cursor position update
   */
  const sendCursorMove = useCallback(
    (x: number, y: number, viewportId?: string) => {
      send("cursor_move", { x, y, viewport_id: viewportId });
    },
    [send]
  );

  /**
   * Send element selection update
   */
  const sendElementSelect = useCallback(
    (elementIds: string[]) => {
      send("element_select", { element_ids: elementIds });
    },
    [send]
  );

  /**
   * Send element update
   */
  const sendElementUpdate = useCallback(
    (elementId: string, changes: Partial<AnnotatedElement>) => {
      send("element_update", { element_id: elementId, changes });
    },
    [send]
  );

  /**
   * Send element add
   */
  const sendElementAdd = useCallback(
    (element: AnnotatedElement) => {
      send("element_add", { element });
    },
    [send]
  );

  /**
   * Send element delete
   */
  const sendElementDelete = useCallback(
    (elementIds: string[]) => {
      send("element_delete", { element_ids: elementIds });
    },
    [send]
  );

  /**
   * Send element move
   */
  const sendElementMove = useCallback(
    (elementIds: string[], deltaX: number, deltaY: number) => {
      send("element_move", {
        element_ids: elementIds,
        delta_x: deltaX,
        delta_y: deltaY,
      });
    },
    [send]
  );

  /**
   * Send element resize
   */
  const sendElementResize = useCallback(
    (elementId: string, bbox: BoundingBox) => {
      send("element_resize", { element_id: elementId, bbox });
    },
    [send]
  );

  /**
   * Auto-connect when annotation set ID changes
   */
  useEffect(() => {
    if (annotationSetId && options.autoConnect !== false) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [annotationSetId, options.autoConnect, connect, disconnect]);

  return {
    isConnected,
    isConnecting,
    error,
    collaborators,
    myColor,
    sendCursorMove,
    sendElementSelect,
    sendElementUpdate,
    sendElementAdd,
    sendElementDelete,
    sendElementMove,
    sendElementResize,
    connect,
    disconnect,
  };
}

export default useAnnotationSync;
