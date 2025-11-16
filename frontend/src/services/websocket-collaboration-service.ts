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
  WebSocketMessageType,
  PresenceUpdateMessage,
  CursorMoveMessage,
  CursorPosition,
} from '@/types/collaboration';
import { ExecutionWebSocket, type WebSocketConfig } from './execution-websocket';

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

  /**
   * Connect to collaboration WebSocket for a project
   */
  connect(projectId: string, config?: Partial<WebSocketConfig>): void {
    if (this.ws && this.projectId === projectId) {
      console.warn('[CollaborationWS] Already connected to this project');
      return;
    }

    // Disconnect from previous project if connected
    if (this.ws) {
      this.disconnect();
    }

    this.projectId = projectId;

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
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
          console.log('[CollaborationWS] Connected');
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
          console.log('[CollaborationWS] Disconnected');
          this.handlers.onDisconnect?.();
        },
        onMessage: (event: any) => {
          this.handleMessage(event);
        },
        onError: (error: Error) => {
          console.error('[CollaborationWS] Error:', error);
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
  sendPresenceUpdate(status: PresenceStatus, currentView?: string | null): void {
    const message: PresenceUpdateMessage = {
      user_id: '', // Will be set by server
      user_name: null,
      user_email: '',
      status,
      current_view: currentView ?? null,
    };

    this.currentPresence = message;

    this.send({
      type: 'presence_update',
      timestamp: new Date().toISOString(),
      data: message,
    });
  }

  /**
   * Send cursor position update
   */
  sendCursorMove(position: CursorPosition): void {
    const message: CursorMoveMessage = {
      user_id: '', // Will be set by server
      user_name: null,
      x: position.x,
      y: position.y,
      viewport_id: position.viewport_id,
    };

    this.send({
      type: 'cursor_move',
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
  private handleMessage(event: any): void {
    try {
      const message = event as WebSocketMessage;

      switch (message.type) {
        case 'presence_update':
          this.handlers.onPresenceUpdate?.(message.data);
          break;

        case 'cursor_move':
          this.handlers.onCursorMove?.(message.data);
          break;

        case 'lock_acquired':
          this.handlers.onLockAcquired?.(message.data);
          break;

        case 'lock_released':
          this.handlers.onLockReleased?.(message.data);
          break;

        case 'comment_added':
          this.handlers.onCommentAdded?.(message.data);
          break;

        case 'comment_updated':
          this.handlers.onCommentUpdated?.(message.data);
          break;

        case 'comment_deleted':
          this.handlers.onCommentDeleted?.(message.data);
          break;

        case 'activity_update':
          this.handlers.onActivityUpdate?.(message.data);
          break;

        case 'pong':
          // Heartbeat response, no action needed
          break;

        default:
          console.warn('[CollaborationWS] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[CollaborationWS] Failed to handle message:', error);
      this.handlers.onError?.(error as Error);
    }
  }

  /**
   * Send a message to the server
   */
  private send(message: WebSocketMessage): void {
    if (!this.ws || !this.ws.isConnected()) {
      console.warn('[CollaborationWS] Cannot send message: not connected');
      return;
    }

    this.ws.send(message);
  }
}

// Export singleton instance
export const websocketCollaborationService = new WebSocketCollaborationService();
