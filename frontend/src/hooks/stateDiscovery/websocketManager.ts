/**
 * WebSocket manager for State Discovery
 * Single Responsibility: Manage WebSocket connections and message handling
 */

export interface WebSocketCallbacks {
  onProgress?: (progress: any) => void;
  onStateImageFound?: (stateImage: any) => void;
  onComplete?: (data: any) => void;
  onError?: (error: string) => void;
}

export class StateDiscoveryWebSocketManager {
  private ws: WebSocket | null = null;
  private callbacks: WebSocketCallbacks = {};
  private analysisId: string | null = null;

  constructor() {
    console.log("[WebSocketManager] Initialized");
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

    console.log("[WebSocketManager] Connecting:", {
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
      console.log("[WebSocketManager] Connected:", {
        analysisId: this.analysisId,
        readyState: this.ws?.readyState,
        timestamp: new Date().toISOString(),
      });
    };

    this.ws.onmessage = (event) => {
      console.log("[WebSocketManager] Message received:", {
        rawData: event.data,
        analysisId: this.analysisId,
        timestamp: new Date().toISOString(),
      });

      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("[WebSocketManager] Failed to parse message:", error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WebSocketManager] Error:", {
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
      console.log("[WebSocketManager] Disconnected:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        analysisId: this.analysisId,
        timestamp: new Date().toISOString(),
      });
    };
  }

  private handleMessage(message: any): void {
    console.log("[WebSocketManager] Handling message:", {
      type: message.type,
      analysisId: this.analysisId,
    });

    switch (message.type) {
      case "progress":
        if (this.callbacks.onProgress) {
          this.callbacks.onProgress(message.data);
        }
        break;

      case "state_image_found":
        if (this.callbacks.onStateImageFound) {
          this.callbacks.onStateImageFound(message.data);
        }
        break;

      case "complete":
        if (this.callbacks.onComplete) {
          this.callbacks.onComplete(message.data);
        }
        break;

      case "error":
        console.error("[WebSocketManager] Error message:", message.data);
        if (this.callbacks.onError) {
          this.callbacks.onError(message.data.message);
        }
        break;

      case "pong":
        console.log("[WebSocketManager] Pong received");
        break;

      default:
        console.log("[WebSocketManager] Unhandled message type:", message.type);
        break;
    }
  }

  sendMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      console.log("[WebSocketManager] Sent message:", message);
    } else {
      console.warn(
        "[WebSocketManager] Cannot send message, WebSocket not connected"
      );
    }
  }

  sendPing(): void {
    this.sendMessage({ type: "ping" });
  }

  disconnect(): void {
    if (this.ws) {
      console.log(
        "[WebSocketManager] Closing connection for:",
        this.analysisId
      );
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
