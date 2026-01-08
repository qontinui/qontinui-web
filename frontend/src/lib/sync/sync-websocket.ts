/**
 * Sync WebSocket Client
 *
 * Manages WebSocket connection for real-time sync events.
 * Handles lock notifications, version updates, and conflict detection.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Event-based architecture for lock/version updates
 * - Connection state management
 * - Heartbeat/ping-pong for connection health
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * WebSocket event types from server
 */
export type SyncWebSocketEventType =
  | "LOCK_ACQUIRED"
  | "LOCK_RELEASED"
  | "VERSION_UPDATED"
  | "CONFLICT"
  | "PING"
  | "ERROR";

/**
 * WebSocket events from server
 */
export type SyncWebSocketEvent =
  | {
      type: "LOCK_ACQUIRED";
      lockId: string;
      operation: string;
      userId: string;
    }
  | { type: "LOCK_RELEASED"; lockId: string; newVersion: number }
  | { type: "VERSION_UPDATED"; version: number; source: string }
  | { type: "CONFLICT"; localVersion: number; serverVersion: number }
  | { type: "PING" }
  | { type: "ERROR"; message: string };

/**
 * Client-to-server messages
 */
export type SyncWebSocketMessage =
  | { type: "PONG" }
  | { type: "SUBSCRIBE"; projectId: string }
  | { type: "UNSUBSCRIBE" };

/**
 * Connection state
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Event handler type
 */
export type SyncEventHandler = (event: SyncWebSocketEvent) => void;

/**
 * Connection state handler type
 */
export type ConnectionStateHandler = (state: ConnectionState) => void;

/**
 * WebSocket client configuration
 */
export interface SyncWebSocketConfig {
  /** Base URL for WebSocket connection */
  baseUrl: string;
  /** Initial reconnect delay (ms) */
  reconnectDelay: number;
  /** Maximum reconnect delay (ms) */
  maxReconnectDelay: number;
  /** Reconnect backoff multiplier */
  reconnectBackoff: number;
  /** Maximum reconnect attempts (0 = unlimited) */
  maxReconnectAttempts: number;
  /** Ping interval for keepalive (ms) */
  pingInterval: number;
  /** Pong timeout - disconnect if no pong received (ms) */
  pongTimeout: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SyncWebSocketConfig = {
  baseUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000",
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectBackoff: 1.5,
  maxReconnectAttempts: 0, // Unlimited
  pingInterval: 30000,
  pongTimeout: 10000,
};

/**
 * Sync WebSocket Client implementation
 */
class SyncWebSocketClientImpl {
  private config: SyncWebSocketConfig;
  private ws: WebSocket | null = null;
  private projectId: string | null = null;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempts: number = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private eventHandlers: Set<SyncEventHandler> = new Set();
  private stateHandlers: Set<ConnectionStateHandler> = new Set();
  private authToken: string | null = null;

  constructor(config: Partial<SyncWebSocketConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  /**
   * Connect to WebSocket for a project
   */
  connect(projectId: string): void {
    if (this.projectId === projectId && this.connectionState === "connected") {
      return; // Already connected to this project
    }

    // Disconnect from previous project if any
    if (this.ws) {
      this.disconnect();
    }

    this.projectId = projectId;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.clearTimers();

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }

    this.projectId = null;
    this.setConnectionState("disconnected");

    projectLogger.debug("SyncWebSocket", "Disconnected");
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Subscribe to sync events
   */
  onEvent(handler: SyncEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionState(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.connectionState);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  // Private methods

  private doConnect(): void {
    if (!this.projectId) return;

    this.setConnectionState("connecting");

    const url = this.buildWebSocketUrl();
    projectLogger.debug("SyncWebSocket", "Connecting", { url });

    try {
      this.ws = new WebSocket(url);
      this.setupWebSocketHandlers();
    } catch (error) {
      projectLogger.error("SyncWebSocket", "Connection failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      this.setConnectionState("error");
      this.scheduleReconnect();
    }
  }

  private buildWebSocketUrl(): string {
    // Convert http(s) to ws(s) if needed
    let baseUrl = this.config.baseUrl;
    if (baseUrl.startsWith("http://")) {
      baseUrl = baseUrl.replace("http://", "ws://");
    } else if (baseUrl.startsWith("https://")) {
      baseUrl = baseUrl.replace("https://", "wss://");
    }

    let url = `${baseUrl}/ws/projects/${this.projectId}/sync`;

    // Add auth token as query param if available
    if (this.authToken) {
      url += `?token=${encodeURIComponent(this.authToken)}`;
    }

    return url;
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      projectLogger.info("SyncWebSocket", "Connected", {
        projectId: this.projectId,
      });
      this.setConnectionState("connected");
      this.reconnectAttempts = 0;
      this.startPingInterval();
    };

    this.ws.onclose = (event) => {
      projectLogger.info("SyncWebSocket", "Connection closed", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.clearTimers();

      if (this.projectId) {
        // Only reconnect if we still have a project ID (not manually disconnected)
        this.setConnectionState("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setConnectionState("disconnected");
      }
    };

    this.ws.onerror = (error) => {
      projectLogger.error("SyncWebSocket", "WebSocket error", {
        error: error instanceof Event ? "WebSocket error event" : String(error),
      });
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as SyncWebSocketEvent;

      // Handle ping/pong internally
      if (message.type === "PING") {
        this.sendMessage({ type: "PONG" });
        return;
      }

      // Reset pong timeout on any message
      this.resetPongTimeout();

      // Notify handlers
      this.notifyEventHandlers(message);

      projectLogger.debug("SyncWebSocket", "Message received", { message });
    } catch (error) {
      projectLogger.error("SyncWebSocket", "Failed to parse message", {
        data,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private sendMessage(message: SyncWebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startPingInterval(): void {
    this.clearTimers();

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Start pong timeout
        this.pongTimeout = setTimeout(() => {
          projectLogger.warn("SyncWebSocket", "Pong timeout, reconnecting");
          this.ws?.close();
        }, this.config.pongTimeout);
      }
    }, this.config.pingInterval);
  }

  private resetPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private clearTimers(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.resetPongTimeout();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      projectLogger.error("SyncWebSocket", "Max reconnect attempts reached");
      this.setConnectionState("error");
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay *
        Math.pow(this.config.reconnectBackoff, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    projectLogger.debug("SyncWebSocket", "Scheduling reconnect", {
      attempt: this.reconnectAttempts + 1,
      delay,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.doConnect();
    }, delay);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;

    this.connectionState = state;

    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch (error) {
        console.error("[SyncWebSocket] Error in state handler:", error);
      }
    }
  }

  private notifyEventHandlers(event: SyncWebSocketEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[SyncWebSocket] Error in event handler:", error);
      }
    }
  }
}

/**
 * Create a new sync WebSocket client
 */
export function createSyncWebSocketClient(
  config?: Partial<SyncWebSocketConfig>
): SyncWebSocketClientImpl {
  return new SyncWebSocketClientImpl(config);
}

export type SyncWebSocketClient = SyncWebSocketClientImpl;
