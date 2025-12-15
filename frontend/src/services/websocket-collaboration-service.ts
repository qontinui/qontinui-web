/**
 * WebSocket Collaboration Service
 *
 * Real-time collaboration features via WebSocket:
 * - Presence tracking
 * - Cursor positions
 * - Lock notifications
 * - Comment updates
 * - Activity streaming
 */

import type {
  UserPresence,
  PresenceStatus,
  Lock,
  Comment,
  Activity,
  WebSocketMessage,
  PresenceUpdateMessage,
  CursorMoveMessage,
  CursorPosition,
} from "@/types/collaboration";
import {
  ExecutionWebSocket,
  type WebSocketConfig,
} from "./execution-websocket";

// ============================================================================
// Types
// ============================================================================

type MessageHandler<T = any> = (data: T) => void;

interface CollaborationHandlers {
  onPresenceUpdate?: MessageHandler<UserPresence[]>;
  onCursorMove?: MessageHandler<CursorMoveMessage>;
  onLockAcquired?: MessageHandler<Lock>;
  onLockReleased?: MessageHandler<Lock>;
  onCommentAdded?: MessageHandler<Comment>;
  onCommentUpdated?: MessageHandler<Comment>;
  onCommentDeleted?: MessageHandler<string>;
  onActivityUpdate?: MessageHandler<Activity>;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// WebSocket Collaboration Service
// ============================================================================

class WebSocketCollaborationService {
  private ws: ExecutionWebSocket | null = null;
  private projectId: string | null = null;
  private handlers: CollaborationHandlers = {};
  private currentPresence: PresenceUpdateMessage | null = null;

  // Message sequencing fields
  private lastReceivedSequence: number = 0;
  private outOfOrderBuffer: Map<number, unknown> = new Map();
  private expectedSequence: number = 1;
  private ackBatchSize: number = 10; // Send ack every N messages
  private unacknowledgedCount: number = 0;
  private lastAckedSequence: number = 0;

  /**
   * Connect to collaboration WebSocket for a project
   */
  connect(projectId: string, config?: Partial<WebSocketConfig>): void {
    if (this.ws && this.projectId === projectId) {
      console.warn("[CollaborationWS] Already connected to this project");
      return;
    }

    // Disconnect from previous project if connected
    if (this.ws) {
      this.disconnect();
    }

    this.projectId = projectId;

    // Determine WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/api/collaboration/${projectId}/ws`;

    // Create WebSocket connection
    this.ws = new ExecutionWebSocket(
      {
        url,
        autoReconnect: true,
        maxReconnectAttempts: 10,
        heartbeatInterval: 30000,
        ...config,
      },
      {
        onConnect: () => {
          console.log("[CollaborationWS] Connected");

          // Request sync state if reconnecting (not first connection)
          if (this.lastAckedSequence > 0) {
            console.log(
              "[CollaborationWS] Reconnecting, requesting sync state"
            );
            this.send({
              type: "sync_state" as unknown,
              timestamp: new Date().toISOString(),
              data: {
                last_acked_sequence: this.lastAckedSequence,
                last_received_sequence: this.lastReceivedSequence,
              },
            });
          }

          // Send initial presence
          if (this.currentPresence) {
            this.sendPresenceUpdate(
              this.currentPresence.status,
              this.currentPresence.current_view
            );
          }
          this.handlers.onConnect?.();
        },
        onDisconnect: () => {
          console.log("[CollaborationWS] Disconnected");
          // Don't reset sequence tracking on disconnect - preserve for reconnect
          this.handlers.onDisconnect?.();
        },
        onMessage: (event: unknown) => {
          this.handleMessage(event);
        },
        onError: (error: unknown) => {
          console.error("[CollaborationWS] Error:", error);
          this.handlers.onError?.(error);
        },
      }
    );

    this.ws.connect();
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }
    this.projectId = null;
    this.currentPresence = null;
    this.resetSequenceTracking();
  }

  /**
   * Reset sequence tracking state
   */
  private resetSequenceTracking(): void {
    this.lastReceivedSequence = 0;
    this.expectedSequence = 1;
    this.outOfOrderBuffer.clear();
    this.unacknowledgedCount = 0;
    this.lastAckedSequence = 0;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.isConnected() ?? false;
  }

  /**
   * Update event handlers
   */
  updateHandlers(handlers: Partial<CollaborationHandlers>): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Send presence update
   */
  sendPresenceUpdate(
    status: PresenceStatus,
    currentView?: string | null
  ): void {
    const message: PresenceUpdateMessage = {
      user_id: "", // Will be set by server
      user_name: null,
      user_email: "",
      status,
      current_view: currentView ?? null,
    };

    this.currentPresence = message;

    this.send({
      type: "presence_update",
      timestamp: new Date().toISOString(),
      data: message,
    });
  }

  /**
   * Send cursor position update
   */
  sendCursorMove(position: CursorPosition): void {
    const message: CursorMoveMessage = {
      user_id: "", // Will be set by server
      user_name: null,
      x: position.x,
      y: position.y,
      viewport_id: position.viewport_id,
    };

    this.send({
      type: "cursor_move",
      timestamp: new Date().toISOString(),
      data: message,
    });
  }

  /**
   * Subscribe to presence updates
   */
  onPresenceUpdate(handler: MessageHandler<UserPresence[]>): () => void {
    this.handlers.onPresenceUpdate = handler;
    return () => {
      this.handlers.onPresenceUpdate = undefined;
    };
  }

  /**
   * Subscribe to cursor movements
   */
  onCursorMove(handler: MessageHandler<CursorMoveMessage>): () => void {
    this.handlers.onCursorMove = handler;
    return () => {
      this.handlers.onCursorMove = undefined;
    };
  }

  /**
   * Subscribe to lock acquired events
   */
  onLockAcquired(handler: MessageHandler<Lock>): () => void {
    this.handlers.onLockAcquired = handler;
    return () => {
      this.handlers.onLockAcquired = undefined;
    };
  }

  /**
   * Subscribe to lock released events
   */
  onLockReleased(handler: MessageHandler<Lock>): () => void {
    this.handlers.onLockReleased = handler;
    return () => {
      this.handlers.onLockReleased = undefined;
    };
  }

  /**
   * Subscribe to comment added events
   */
  onCommentAdded(handler: MessageHandler<Comment>): () => void {
    this.handlers.onCommentAdded = handler;
    return () => {
      this.handlers.onCommentAdded = undefined;
    };
  }

  /**
   * Subscribe to comment updated events
   */
  onCommentUpdated(handler: MessageHandler<Comment>): () => void {
    this.handlers.onCommentUpdated = handler;
    return () => {
      this.handlers.onCommentUpdated = undefined;
    };
  }

  /**
   * Subscribe to comment deleted events
   */
  onCommentDeleted(handler: MessageHandler<string>): () => void {
    this.handlers.onCommentDeleted = handler;
    return () => {
      this.handlers.onCommentDeleted = undefined;
    };
  }

  /**
   * Subscribe to activity updates
   */
  onActivityUpdate(handler: MessageHandler<Activity>): () => void {
    this.handlers.onActivityUpdate = handler;
    return () => {
      this.handlers.onActivityUpdate = undefined;
    };
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: unknown): void {
    try {
      const message = event as WebSocketMessage & { sequence?: number };

      // Handle connection state message
      if (message.type === "connection_state") {
        this.handleConnectionState(message.data);
        return;
      }

      // Handle resend complete message
      if (message.type === "resend_complete") {
        console.log(
          "[CollaborationWS] Resend complete:",
          message.data?.count,
          "messages"
        );
        return;
      }

      // Handle messages with sequence numbers
      if (message.sequence !== undefined) {
        this.processSequencedMessage(message);
      } else {
        // Process non-sequenced messages immediately
        this.dispatchMessage(message);
      }
    } catch (error) {
      console.error("[CollaborationWS] Failed to handle message:", error);
      this.handlers.onError?.(error as Error);
    }
  }

  /**
   * Process a sequenced message (handle ordering)
   */
  private processSequencedMessage(message: unknown): void {
    const sequence = message.sequence;

    // Track the highest sequence we've received
    if (sequence > this.lastReceivedSequence) {
      this.lastReceivedSequence = sequence;
    }

    // Check if this is the next expected message
    if (sequence === this.expectedSequence) {
      // Process this message
      this.dispatchMessage(message);
      this.expectedSequence++;

      // Send acknowledgment (batched)
      this.acknowledgeMessage(sequence);

      // Check if we can process any buffered messages
      this.processBufferedMessages();
    } else if (sequence > this.expectedSequence) {
      // Out of order - buffer it
      console.warn(
        "[CollaborationWS] Out-of-order message:",
        sequence,
        "expected:",
        this.expectedSequence
      );
      this.outOfOrderBuffer.set(sequence, message);

      // Request resend if gap is too large
      const gap = sequence - this.expectedSequence;
      if (gap > 5) {
        console.warn(
          "[CollaborationWS] Large gap detected, requesting resend from",
          this.expectedSequence
        );
        this.requestResend(this.expectedSequence);
      }
    } else {
      // Duplicate or old message - ignore
      console.debug(
        "[CollaborationWS] Duplicate/old message:",
        sequence,
        "expected:",
        this.expectedSequence
      );
    }
  }

  /**
   * Process buffered out-of-order messages
   */
  private processBufferedMessages(): void {
    while (this.outOfOrderBuffer.has(this.expectedSequence)) {
      const message = this.outOfOrderBuffer.get(this.expectedSequence)!;
      this.outOfOrderBuffer.delete(this.expectedSequence);

      this.dispatchMessage(message);
      this.expectedSequence++;

      // Acknowledge
      this.acknowledgeMessage(this.expectedSequence - 1);
    }
  }

  /**
   * Dispatch message to appropriate handler
   */
  private dispatchMessage(message: unknown): void {
    switch (message.type) {
      case "presence_update":
        this.handlers.onPresenceUpdate?.(message.data);
        break;

      case "cursor_move":
        this.handlers.onCursorMove?.(message.data);
        break;

      case "lock_acquired":
        this.handlers.onLockAcquired?.(message.data);
        break;

      case "lock_released":
        this.handlers.onLockReleased?.(message.data);
        break;

      case "comment_added":
        this.handlers.onCommentAdded?.(message.data);
        break;

      case "comment_updated":
        this.handlers.onCommentUpdated?.(message.data);
        break;

      case "comment_deleted":
        this.handlers.onCommentDeleted?.(message.data);
        break;

      case "activity_update":
        this.handlers.onActivityUpdate?.(message.data);
        break;

      case "pong":
      case "heartbeat_ack":
        // Heartbeat response, no action needed
        break;

      default:
        console.warn("[CollaborationWS] Unknown message type:", message.type);
    }
  }

  /**
   * Send acknowledgment for received message
   */
  private acknowledgeMessage(sequence: number): void {
    this.unacknowledgedCount++;

    // Batch acknowledgments
    if (this.unacknowledgedCount >= this.ackBatchSize) {
      this.sendAck(sequence);
      this.unacknowledgedCount = 0;
      this.lastAckedSequence = sequence;
    }
  }

  /**
   * Send acknowledgment to server
   */
  private sendAck(sequence: number): void {
    this.send({
      type: "ack" as unknown,
      timestamp: new Date().toISOString(),
      data: { sequence },
    });

    console.debug("[CollaborationWS] Acknowledged up to sequence:", sequence);
  }

  /**
   * Request resend of messages from a specific sequence
   */
  private requestResend(fromSequence: number): void {
    this.send({
      type: "resend" as unknown,
      timestamp: new Date().toISOString(),
      data: { from_sequence: fromSequence },
    });

    console.log(
      "[CollaborationWS] Requested resend from sequence:",
      fromSequence
    );
  }

  /**
   * Handle connection state message
   */
  private handleConnectionState(state: unknown): void {
    console.log("[CollaborationWS] Connection state:", state);

    // If reconnecting and there are unacknowledged messages, request resend
    if (
      this.lastAckedSequence > 0 &&
      state.message_sequence > this.lastAckedSequence
    ) {
      const fromSequence = this.lastAckedSequence + 1;
      console.log(
        "[CollaborationWS] Reconnected, requesting resend from:",
        fromSequence
      );
      this.requestResend(fromSequence);
    }
  }

  /**
   * Force send acknowledgment (for important messages)
   */
  public forceAcknowledge(): void {
    if (this.lastReceivedSequence > this.lastAckedSequence) {
      this.sendAck(this.lastReceivedSequence);
      this.unacknowledgedCount = 0;
      this.lastAckedSequence = this.lastReceivedSequence;
    }
  }

  /**
   * Get current sequence tracking state (for debugging)
   */
  public getSequenceState(): {
    lastReceived: number;
    expected: number;
    lastAcked: number;
    bufferedCount: number;
    unacknowledged: number;
  } {
    return {
      lastReceived: this.lastReceivedSequence,
      expected: this.expectedSequence,
      lastAcked: this.lastAckedSequence,
      bufferedCount: this.outOfOrderBuffer.size,
      unacknowledged: this.unacknowledgedCount,
    };
  }

  /**
   * Send a message to the server
   */
  private send(message: WebSocketMessage): void {
    if (!this.ws || !this.ws.isConnected()) {
      console.warn("[CollaborationWS] Cannot send message: not connected");
      return;
    }

    this.ws.send(message);
  }
}

// Export singleton instance
export const websocketCollaborationService =
  new WebSocketCollaborationService();
