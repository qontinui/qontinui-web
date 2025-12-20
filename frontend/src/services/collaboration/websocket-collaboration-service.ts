/**
 * WebSocket Collaboration Service
 *
 * Provides real-time collaboration features via WebSocket:
 * - User presence tracking
 * - Cursor position sharing
 * - Lock notifications
 * - Resource updates
 * - Comment notifications
 * - Activity updates
 * - Automatic reconnection with exponential backoff
 * - Connection state management
 */

import { ApiConfig } from "../api-config";
import type {
  PresenceStatus,
  WebSocketMessage,
  PresenceUpdateMessage,
  CursorMoveMessage,
  LockUpdateMessage,
  ResourceUpdateMessage,
  ResourceType,
  Comment,
  Activity,
  UserPresence,
} from "@/types/collaboration";

// ============================================================================
// Types
// ============================================================================

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface WebSocketCollaborationConfig {
  projectId: string;
  token: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
}

export interface CollaborationCallbacks {
  onPresenceUpdate?: (presence: UserPresence) => void;
  onCursorMove?: (data: CursorMoveMessage) => void;
  onLockUpdate?: (data: LockUpdateMessage) => void;
  onResourceUpdate?: (data: ResourceUpdateMessage) => void;
  onCommentAdded?: (comment: Comment) => void;
  onCommentUpdated?: (comment: Comment) => void;
  onCommentDeleted?: (commentId: string) => void;
  onActivityUpdate?: (activity: Activity) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: ConnectionState) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  heartbeatInterval: 30000,
};

// ============================================================================
// WebSocket Collaboration Service
// ============================================================================

export class WebSocketCollaborationService {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketCollaborationConfig>;
  private callbacks: CollaborationCallbacks;

  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;

  private projectId: string;
  private isManualClose = false;
  private messageQueue: WebSocketMessage[] = [];

  constructor(
    config: WebSocketCollaborationConfig,
    callbacks: CollaborationCallbacks = {}
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    this.callbacks = callbacks;
    this.projectId = config.projectId;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to the collaboration WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.state !== "disconnected" && this.state !== "failed") {
        console.warn(
          "[WebSocketCollaboration] Already connected or connecting"
        );
        resolve();
        return;
      }

      this.isManualClose = false;
      this.setState("connecting");

      const wsUrl = this.buildWebSocketUrl();

      try {
        this.ws = new WebSocket(wsUrl);
        this.setupWebSocketHandlers(resolve, reject);
      } catch (error) {
        console.error(
          "[WebSocketCollaboration] Failed to create WebSocket:",
          error
        );
        this.handleError(error as Error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    this.isManualClose = true;
    this.cleanup();
    this.setState("disconnected");
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  // ============================================================================
  // Presence Updates
  // ============================================================================

  /**
   * Send presence update
   */
  sendPresenceUpdate(status: PresenceStatus, currentView?: string): void {
    const message: WebSocketMessage = {
      type: "presence_update",
      timestamp: new Date().toISOString(),
      data: {
        status,
        current_view: currentView,
      } as PresenceUpdateMessage,
    };

    this.send(message);
  }

  /**
   * Send cursor position update
   */
  sendCursorPosition(x: number, y: number, viewportId?: string): void {
    const message: WebSocketMessage = {
      type: "cursor_move",
      timestamp: new Date().toISOString(),
      data: {
        x,
        y,
        viewport_id: viewportId,
      },
    };

    this.send(message);
  }

  /**
   * Send resource update notification
   */
  sendResourceUpdate(
    resourceType: ResourceType,
    resourceId: string,
    changes: Record<string, unknown>
  ): void {
    const message: WebSocketMessage = {
      type: "resource_update",
      timestamp: new Date().toISOString(),
      data: {
        resource_type: resourceType,
        resource_id: resourceId,
        changes,
      } as ResourceUpdateMessage,
    };

    this.send(message);
  }

  // ============================================================================
  // Callback Registration
  // ============================================================================

  /**
   * Register callback for presence updates
   */
  onPresenceUpdate(callback: (presence: UserPresence) => void): void {
    this.callbacks.onPresenceUpdate = callback;
  }

  /**
   * Register callback for cursor movements
   */
  onCursorMove(callback: (data: CursorMoveMessage) => void): void {
    this.callbacks.onCursorMove = callback;
  }

  /**
   * Register callback for lock updates
   */
  onLockUpdate(callback: (data: LockUpdateMessage) => void): void {
    this.callbacks.onLockUpdate = callback;
  }

  /**
   * Register callback for resource updates
   */
  onResourceUpdate(callback: (data: ResourceUpdateMessage) => void): void {
    this.callbacks.onResourceUpdate = callback;
  }

  /**
   * Register callback for comment additions
   */
  onCommentAdded(callback: (comment: Comment) => void): void {
    this.callbacks.onCommentAdded = callback;
  }

  /**
   * Register callback for comment updates
   */
  onCommentUpdated(callback: (comment: Comment) => void): void {
    this.callbacks.onCommentUpdated = callback;
  }

  /**
   * Register callback for comment deletions
   */
  onCommentDeleted(callback: (commentId: string) => void): void {
    this.callbacks.onCommentDeleted = callback;
  }

  /**
   * Register callback for activity updates
   */
  onActivityUpdate(callback: (activity: Activity) => void): void {
    this.callbacks.onActivityUpdate = callback;
  }

  // ============================================================================
  // Private Methods - WebSocket Management
  // ============================================================================

  /**
   * Build the WebSocket URL
   */
  private buildWebSocketUrl(): string {
    const baseUrl = ApiConfig.API_BASE_URL.replace("http://", "ws://").replace(
      "https://",
      "wss://"
    );
    const url = new URL(
      `${baseUrl}/api/v1/projects/${this.projectId}/collaboration/ws`
    );
    url.searchParams.set("token", this.config.token);
    return url.toString();
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    if (!this.ws) return;

    let hasResolved = false;

    this.ws.onopen = () => {
      console.log("[WebSocketCollaboration] Connected");
      this.setState("connected");
      this.reconnectAttempts = 0;

      // Start heartbeat
      this.startHeartbeat();

      // Flush message queue
      this.flushMessageQueue();

      // Notify callback
      if (this.callbacks.onConnect) {
        this.callbacks.onConnect();
      }

      if (!hasResolved) {
        hasResolved = true;
        resolve();
      }
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (event) => {
      console.error("[WebSocketCollaboration] Error:", event);
      const error = new Error("WebSocket error");
      this.handleError(error);

      if (!hasResolved) {
        hasResolved = true;
        reject(error);
      }
    };

    this.ws.onclose = (event) => {
      console.log("[WebSocketCollaboration] Closed:", event.code, event.reason);

      this.stopHeartbeat();

      const reason = event.reason || `Code ${event.code}`;

      if (!this.isManualClose) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }

      if (this.callbacks.onDisconnect) {
        this.callbacks.onDisconnect(reason);
      }
    };
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      // Handle heartbeat pong
      if (message.type === "pong") {
        this.resetHeartbeatTimeout();
        return;
      }

      // Route message to appropriate handler
      switch (message.type) {
        case "presence_update":
          if (this.callbacks.onPresenceUpdate) {
            this.callbacks.onPresenceUpdate(message.data as UserPresence);
          }
          break;

        case "cursor_move":
          if (this.callbacks.onCursorMove) {
            this.callbacks.onCursorMove(message.data as CursorMoveMessage);
          }
          break;

        case "lock_acquired":
        case "lock_released":
          if (this.callbacks.onLockUpdate) {
            this.callbacks.onLockUpdate(message.data as LockUpdateMessage);
          }
          break;

        case "resource_update":
          if (this.callbacks.onResourceUpdate) {
            this.callbacks.onResourceUpdate(
              message.data as ResourceUpdateMessage
            );
          }
          break;

        case "comment_added":
          if (this.callbacks.onCommentAdded) {
            this.callbacks.onCommentAdded(message.data as Comment);
          }
          break;

        case "comment_updated":
          if (this.callbacks.onCommentUpdated) {
            this.callbacks.onCommentUpdated(message.data as Comment);
          }
          break;

        case "comment_deleted":
          if (this.callbacks.onCommentDeleted) {
            this.callbacks.onCommentDeleted(
              (message.data as { comment_id: string }).comment_id
            );
          }
          break;

        case "activity_update":
          if (this.callbacks.onActivityUpdate) {
            this.callbacks.onActivityUpdate(message.data as Activity);
          }
          break;

        default:
          console.warn(
            "[WebSocketCollaboration] Unknown message type:",
            message.type
          );
      }
    } catch (error) {
      console.error("[WebSocketCollaboration] Failed to parse message:", error);
      this.handleError(error as Error);
    }
  }

  /**
   * Send a message
   */
  private send(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      this.messageQueue.push(message);
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  /**
   * Handle error
   */
  private handleError(error: Error): void {
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  // ============================================================================
  // Reconnection Logic
  // ============================================================================

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) {
      this.setState("failed");
      return;
    }

    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      console.error(
        "[WebSocketCollaboration] Max reconnection attempts reached"
      );
      this.setState("failed");
      return;
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay
    );

    console.log(
      `[WebSocketCollaboration] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts || "∞"})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect().catch((error) => {
        console.error("[WebSocketCollaboration] Reconnection failed:", error);
      });
    }, delay);
  }

  // ============================================================================
  // Heartbeat Mechanism
  // ============================================================================

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const message: WebSocketMessage = {
          type: "ping",
          timestamp: new Date().toISOString(),
          data: {},
        };
        this.send(message);
        this.startHeartbeatTimeout();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Start heartbeat timeout
   */
  private startHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    this.heartbeatTimeout = setTimeout(() => {
      console.warn(
        "[WebSocketCollaboration] Heartbeat timeout - connection appears dead"
      );
      if (this.ws) {
        this.ws.close();
      }
    }, 5000); // 5 second timeout
  }

  /**
   * Reset heartbeat timeout (pong received)
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Set connection state
   */
  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return;
    }

    console.log(`[WebSocketCollaboration] State: ${this.state} -> ${state}`);
    this.state = state;

    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(state);
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    // Close WebSocket
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }

      this.ws = null;
    }

    // Clear timeouts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeat();

    // Clear message queue
    this.messageQueue = [];
  }

  /**
   * Destroy the service and cleanup all resources
   */
  destroy(): void {
    this.disconnect();
    this.callbacks = {};
  }
}
