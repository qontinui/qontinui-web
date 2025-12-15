/**
 * Execution WebSocket Handler
 *
 * Advanced WebSocket manager for execution event streaming with:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat/keepalive mechanism
 * - Message queuing for offline mode
 * - Connection state management
 * - Error recovery
 * - Event replay on reconnection
 */

import type { ExecutionEvent } from "./backend-api";

// ============================================================================
// Types
// ============================================================================

/**
 * WebSocket error classification codes
 */
export enum WebSocketErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
  SERVER_ERROR = "SERVER_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
}

/**
 * Classified error with metadata
 */
export interface ClassifiedError {
  /** Error classification code */
  code: WebSocketErrorCode;

  /** Original error message */
  message: string;

  /** Timestamp when error occurred */
  timestamp: Date;

  /** Whether this error type is retryable */
  retryable: boolean;

  /** User-friendly error message */
  userMessage?: string;
}

/**
 * WebSocket connection state
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  /** WebSocket URL */
  url: string;

  /** Enable automatic reconnection */
  autoReconnect?: boolean;

  /** Maximum reconnection attempts (0 = unlimited) */
  maxReconnectAttempts?: number;

  /** Initial reconnect delay (ms) */
  reconnectDelay?: number;

  /** Maximum reconnect delay (ms) */
  maxReconnectDelay?: number;

  /** Heartbeat interval (ms) */
  heartbeatInterval?: number;

  /** Heartbeat timeout (ms) */
  heartbeatTimeout?: number;

  /** Enable message queuing when offline */
  enableQueue?: boolean;

  /** Maximum queue size */
  maxQueueSize?: number;

  /** Authentication token */
  authToken?: string;
}

/**
 * WebSocket event handlers
 */
export interface WebSocketHandlers {
  /** Called when connection is established */
  onConnect?: () => void;

  /** Called when connection is lost */
  onDisconnect?: (reason: string) => void;

  /** Called when a message is received */
  onMessage?: (event: ExecutionEvent) => void;

  /** Called when an error occurs */
  onError?: (error: ClassifiedError) => void;

  /** Called when connection state changes */
  onStateChange?: (state: ConnectionState) => void;

  /** Called when reconnection attempt starts */
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
}

/**
 * Queued message
 */
interface QueuedMessage {
  data: string;
  timestamp: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<WebSocketConfig, "url" | "authToken">> = {
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  heartbeatInterval: 30000,
  heartbeatTimeout: 5000,
  enableQueue: true,
  maxQueueSize: 100,
};

// ============================================================================
// Execution WebSocket Manager
// ============================================================================

/**
 * WebSocket manager for execution event streaming
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat to detect dead connections
 * - Message queuing for offline mode
 * - Connection state tracking
 * - Error recovery
 */
export class ExecutionWebSocket {
  private config: Required<WebSocketConfig>;
  private handlers: WebSocketHandlers;

  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;

  private messageQueue: QueuedMessage[] = [];
  private lastEventId: string | null = null;

  private isManualClose = false;

  /**
   * Create a new WebSocket manager
   */
  constructor(config: WebSocketConfig, handlers: WebSocketHandlers = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      authToken: config.authToken ?? "",
    };
    this.handlers = handlers;
    this.maxReconnectAttempts = this.config.maxReconnectAttempts;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws && this.state !== "disconnected" && this.state !== "failed") {
      console.warn("[ExecutionWebSocket] Already connected or connecting");
      return;
    }

    this.isManualClose = false;
    this.setState("connecting");
    this.createWebSocket();
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isManualClose = true;
    this.cleanup();
    this.setState("disconnected");
  }

  /**
   * Send a message to the server
   *
   * If connection is offline and queuing is enabled, message will be queued.
   */
  send(data: unknown): void {
    const message = typeof data === "string" ? data : JSON.stringify(data);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else if (this.config.enableQueue) {
      this.queueMessage(message);
    } else {
      console.warn("[ExecutionWebSocket] Cannot send message: not connected");
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get number of queued messages
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WebSocketConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Update handlers
   */
  updateHandlers(handlers: Partial<WebSocketHandlers>): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  // ==========================================================================
  // Private Methods - WebSocket Management
  // ==========================================================================

  /**
   * Create and configure WebSocket connection
   */
  private createWebSocket(): void {
    try {
      // Add auth token to URL if provided
      let url = this.config.url;
      if (this.config.authToken) {
        const separator = url.includes("?") ? "&" : "?";
        url += `${separator}token=${encodeURIComponent(this.config.authToken)}`;
      }

      // Add last event ID for event replay
      if (this.lastEventId) {
        const separator = url.includes("?") ? "&" : "?";
        url += `${separator}last_event_id=${encodeURIComponent(this.lastEventId)}`;
      }

      this.ws = new WebSocket(url);
      this.setupWebSocketHandlers();
    } catch (error) {
      console.error("[ExecutionWebSocket] Failed to create WebSocket:", error);
      this.handleError(error as Error);
      this.scheduleReconnect();
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log("[ExecutionWebSocket] Connected");
      this.setState("connected");
      this.reconnectAttempts = 0;

      // Start heartbeat
      this.startHeartbeat();

      // Flush message queue
      this.flushMessageQueue();

      // Call handler
      if (this.handlers.onConnect) {
        this.handlers.onConnect();
      }
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (event) => {
      console.error("[ExecutionWebSocket] Error:", event);
      const error = new Error("WebSocket error");
      this.handleError(error);
    };

    this.ws.onclose = (event) => {
      console.log("[ExecutionWebSocket] Closed:", event.code, event.reason);

      this.stopHeartbeat();

      const reason = event.reason || `Code ${event.code}`;

      if (!this.isManualClose) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }

      if (this.handlers.onDisconnect) {
        this.handlers.onDisconnect(reason);
      }
    };
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle heartbeat pong
      if (message.type === "pong") {
        this.resetHeartbeatTimeout();
        return;
      }

      // Store last event ID for replay
      if (message.event_id) {
        this.lastEventId = message.event_id;
      }

      // Parse execution event
      const event: ExecutionEvent = {
        type: message.type,
        executionId: message.execution_id,
        timestamp: new Date(message.timestamp),
        actionId: message.action_id,
        actionType: message.action_type,
        data: message.data,
      };

      // Call handler
      if (this.handlers.onMessage) {
        this.handlers.onMessage(event);
      }
    } catch (error) {
      console.error("[ExecutionWebSocket] Failed to parse message:", error);
      this.handleError(error as Error);
    }
  }

  /**
   * Classify error type and determine retry strategy
   */
  private classifyError(error: Error): ClassifiedError {
    let code = WebSocketErrorCode.SERVER_ERROR;
    let retryable = true;
    let userMessage: string | undefined;

    const msg = error.message.toLowerCase();

    // Classify based on error message patterns
    if (
      msg.includes("network") ||
      msg.includes("connection") ||
      msg.includes("failed to fetch")
    ) {
      code = WebSocketErrorCode.NETWORK_ERROR;
      userMessage = "Network connection lost. Attempting to reconnect...";
    } else if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden")
    ) {
      code = WebSocketErrorCode.AUTH_ERROR;
      retryable = false;
      userMessage = "Authentication failed. Please log in again.";
    } else if (msg.includes("timeout")) {
      code = WebSocketErrorCode.TIMEOUT_ERROR;
      userMessage = "Connection timed out. Retrying...";
    } else if (
      msg.includes("protocol") ||
      msg.includes("invalid") ||
      msg.includes("parse")
    ) {
      code = WebSocketErrorCode.PROTOCOL_ERROR;
      userMessage = "Protocol error. Attempting to reconnect...";
    } else {
      userMessage = "Server error occurred. Attempting to reconnect...";
    }

    return {
      code,
      message: error.message,
      timestamp: new Date(),
      retryable,
      userMessage,
    };
  }

  /**
   * Handle error with classification and retry logic
   */
  private handleError(error: Error): void {
    const classified = this.classifyError(error);

    console.error(
      `[ExecutionWebSocket] ${classified.code}:`,
      classified.message,
      `(retryable: ${classified.retryable})`
    );

    // Call error handler with classified error
    if (this.handlers.onError) {
      this.handlers.onError(classified);
    }

    // Only attempt reconnection if error is retryable
    if (
      classified.retryable &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    } else if (!classified.retryable) {
      // Non-retryable error (e.g., auth error) - mark as failed and stop reconnection
      console.error(
        "[ExecutionWebSocket] Non-retryable error - stopping reconnection"
      );
      this.setState("failed");

      // Clear any pending reconnection attempts
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
    }
  }

  // ==========================================================================
  // Reconnection Logic
  // ==========================================================================

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
      console.error("[ExecutionWebSocket] Max reconnection attempts reached");
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
      `[ExecutionWebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts || "∞"})`
    );

    if (this.handlers.onReconnecting) {
      this.handlers.onReconnecting(
        this.reconnectAttempts,
        this.config.maxReconnectAttempts
      );
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.createWebSocket();
    }, delay);
  }

  // ==========================================================================
  // Heartbeat Mechanism
  // ==========================================================================

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: "ping" });
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
        "[ExecutionWebSocket] Heartbeat timeout - connection appears dead"
      );
      if (this.ws) {
        this.ws.close();
      }
    }, this.config.heartbeatTimeout);
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

  // ==========================================================================
  // Message Queue
  // ==========================================================================

  /**
   * Queue a message for sending when connection is restored
   */
  private queueMessage(data: string): void {
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      // Remove oldest message
      this.messageQueue.shift();
    }

    this.messageQueue.push({
      data,
      timestamp: Date.now(),
    });

    console.log(
      `[ExecutionWebSocket] Message queued (${this.messageQueue.length}/${this.config.maxQueueSize})`
    );
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    console.log(
      `[ExecutionWebSocket] Flushing ${this.messageQueue.length} queued messages`
    );

    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message.data);
      }
    }
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Set connection state
   */
  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return;
    }

    console.log(`[ExecutionWebSocket] State: ${this.state} -> ${state}`);
    this.state = state;

    if (this.handlers.onStateChange) {
      this.handlers.onStateChange(state);
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

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

    // Clear queue if configured
    if (!this.config.enableQueue) {
      this.messageQueue = [];
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an execution WebSocket connection
 *
 * @param executionId - Execution ID
 * @param baseUrl - Base WebSocket URL (e.g., 'ws://localhost:8000')
 * @param handlers - Event handlers
 * @param config - Additional configuration
 * @returns WebSocket manager instance
 */
export function createExecutionWebSocket(
  executionId: string,
  baseUrl: string,
  handlers: WebSocketHandlers,
  config?: Partial<WebSocketConfig>
): ExecutionWebSocket {
  const url = `${baseUrl}/api/execution/${executionId}/stream`;

  const ws = new ExecutionWebSocket(
    {
      url,
      ...config,
    },
    handlers
  );

  return ws;
}
