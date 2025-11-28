"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { websocketCollaborationService } from "@/services/websocket-collaboration-service";
import type { UserPresence, Lock, Comment, Activity } from "./types";

// ============================================================================
// Context Types
// ============================================================================

interface WebSocketHandlers {
  onPresenceUpdate?: (users: UserPresence[]) => void;
  onLockAcquired?: (lock: Lock) => void;
  onLockReleased?: (lock: Lock) => void;
  onCommentAdded?: (comment: Comment) => void;
  onCommentUpdated?: (comment: Comment) => void;
  onCommentDeleted?: (commentId: string) => void;
  onActivityUpdate?: (activity: Activity) => void;
}

interface WebSocketContextValue {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  registerHandlers: (handlers: WebSocketHandlers) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface WebSocketProviderProps {
  children: ReactNode;
  projectId: string;
}

// ============================================================================
// Provider Component
// ============================================================================

export function WebSocketProvider({
  children,
  projectId,
}: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [handlers, setHandlers] = useState<WebSocketHandlers>({});

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Connect to collaboration WebSocket when project changes
   */
  useEffect(() => {
    if (projectId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [projectId]);

  // ============================================================================
  // Methods
  // ============================================================================

  const connect = async () => {
    try {
      websocketCollaborationService.updateHandlers({
        onConnect: () => {
          setIsConnected(true);
        },
        onDisconnect: () => {
          setIsConnected(false);
        },
        onPresenceUpdate: (users) => {
          handlers.onPresenceUpdate?.(users);
        },
        onLockAcquired: (lock) => {
          handlers.onLockAcquired?.(lock);
        },
        onLockReleased: (lock) => {
          handlers.onLockReleased?.(lock);
        },
        onCommentAdded: (comment) => {
          handlers.onCommentAdded?.(comment);
        },
        onCommentUpdated: (comment) => {
          handlers.onCommentUpdated?.(comment);
        },
        onCommentDeleted: (commentId) => {
          handlers.onCommentDeleted?.(commentId);
        },
        onActivityUpdate: (activity) => {
          handlers.onActivityUpdate?.(activity);
        },
      });

      websocketCollaborationService.connect(projectId);
    } catch (error) {
      console.error("[WebSocket] Failed to connect:", error);
      throw error;
    }
  };

  const disconnect = () => {
    websocketCollaborationService.disconnect();
    setIsConnected(false);
  };

  const registerHandlers = (newHandlers: WebSocketHandlers) => {
    setHandlers((prev) => ({ ...prev, ...newHandlers }));
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: WebSocketContextValue = {
    isConnected,
    connect,
    disconnect,
    registerHandlers,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}
