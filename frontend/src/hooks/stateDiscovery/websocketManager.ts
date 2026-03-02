/**
 * WebSocket manager for State Discovery
 * Single Responsibility: Manage WebSocket connections and message handling
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("WebSocketManager");

export interface WebSocketCallbacks {
  onProgress?: (progress: unknown) => void;
  onStateImageFound?: (stateImage: unknown) => void;
  onComplete?: (data: unknown) => void;
  onError?: (error: string) => void;
}

export class StateDiscoveryWebSocketManager {
  private ws: WebSocket | null = null;
  private callbacks: WebSocketCallbacks = {};
  private analysisId: string | null = null;

  constructor() {
    logger.debug("Initialized");
  }

  connect(
    analysisId: string,
    apiBaseUrl: string,
    apiPath: string,
    callbacks: WebSocketCallbacks
  ): void {
    // Close existing connection
    this.disconnect();

    this.analysisId = analysisId;
    this.callbacks = callbacks;

    // Construct WebSocket URL
    const wsProtocol = apiBaseUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = apiBaseUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${wsHost}${apiPath}/state-discovery/ws/${analysisId}`;

    logger.debug("Connecting:", {
      url: wsUrl,
      analysisId,
      timestamp: new Date().toISOString(),
    });

    this.ws = new WebSocket(wsUrl);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      logger.debug("Connected:", {
        analysisId: this.analysisId,
        readyState: this.ws?.readyState,
        timestamp: new Date().toISOString(),
      });
    };

    this.ws.onmessage = (event) => {
      logger.debug("Message received:", {
        rawData: event.data,
        analysisId: this.analysisId,
        timestamp: new Date().toISOString(),
      });

      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        logger.error("Failed to parse message:", error);
      }
    };

    this.ws.onerror = (error) => {
      logger.error("Error:", {
        error,
        analysisId: this.analysisId,
        readyState: this.ws?.readyState,
        timestamp: new Date().toISOString(),
      });

      if (this.callbacks.onError) {
        this.callbacks.onError("WebSocket connection error");
      }
    };

    this.ws.onclose = (event) => {
      logger.debug("Disconnected:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        analysisId: this.analysisId,
        timestamp: new Date().toISOString(),
      });
    };
  }

  private handleMessage(message: unknown): void {
    // Type guard to ensure message has the expected structure
    if (!message || typeof message !== "object" || !("type" in message)) {
      logger.error("Invalid message format:", message);
      return;
    }

    const typedMessage = message as {
      type: string;
      data?: unknown;
    };

    logger.debug("Handling message:", {
      type: typedMessage.type,
      analysisId: this.analysisId,
    });

    switch (typedMessage.type) {
      case "progress":
        if (this.callbacks.onProgress) {
          this.callbacks.onProgress(typedMessage.data);
        }
        break;

      case "state_image_found":
        if (this.callbacks.onStateImageFound) {
          this.callbacks.onStateImageFound(typedMessage.data);
        }
        break;

      case "complete":
        if (this.callbacks.onComplete) {
          this.callbacks.onComplete(typedMessage.data);
        }
        break;

      case "error":
        logger.error("Error message:", typedMessage.data);
        if (this.callbacks.onError) {
          const errorData = typedMessage.data as
            | { message?: string }
            | undefined;
          this.callbacks.onError(errorData?.message || "Unknown error");
        }
        break;

      case "pong":
        logger.debug("Pong received");
        break;

      default:
        logger.debug("Unhandled message type:", typedMessage.type);
        break;
    }
  }

  sendMessage(message: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      logger.debug("Sent message:", message);
    } else {
      logger.warn("Cannot send message, WebSocket not connected");
    }
  }

  sendPing(): void {
    this.sendMessage({ type: "ping" });
  }

  disconnect(): void {
    if (this.ws) {
      logger.debug("Closing connection for:", this.analysisId);
      this.ws.close();
      this.ws = null;
      this.analysisId = null;
      this.callbacks = {};
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getAnalysisId(): string | null {
    return this.analysisId;
  }
}
