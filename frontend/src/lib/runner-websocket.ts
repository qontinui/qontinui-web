/**
 * WebSocket client for real-time runner connection
 *
 * This client allows the web UI to monitor automation sessions in real-time,
 * receiving screenshots, logs, and status updates as the runner executes automations.
 */

export interface RunnerWebSocketConfig {
  url: string;
  token?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  onSessionStart?: (data: SessionStartEvent) => void;
  onScreenshot?: (data: ScreenshotEvent) => void;
  onLog?: (data: LogEvent) => void;
  onSessionEnd?: (data: SessionEndEvent) => void;
}

export interface SessionStartEvent {
  session_id: string;
  project_id: string;
  runner_version?: string;
  runner_os?: string;
  runner_hostname?: string;
  timestamp: string;
}

export interface ScreenshotEvent {
  screenshot_id: string;
  session_id: string;
  name: string;
  presigned_url: string;
  width: number;
  height: number;
  automation_metadata?: {
    state_name?: string;
    action_type?: string;
    mouse_position?: { x: number; y: number };
    click_location?: { x: number; y: number };
    drag_locations?: Array<{ x: number; y: number }>;
    keyboard_events?: Array<{ key: string; timestamp: string }>;
    detected_elements?: Array<{
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    recognition_results?: Array<{
      pattern_id: string;
      confidence: number;
      location: { x: number; y: number };
    }>;
    error?: string;
    execution_time_ms?: number;
  };
  timestamp: string;
}

export interface LogEvent {
  log_id: string;
  session_id: string;
  level: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  message: string;
  log_data?: Record<string, any>;
  sequence_number: number;
  timestamp: string;
}

export interface SessionEndEvent {
  session_id: string;
  status: 'completed' | 'failed' | 'disconnected';
  error_message?: string;
  timestamp: string;
}

export interface WSMessage {
  type: string;
  timestamp: string;
  [key: string]: any;
}

export class RunnerWebSocket {
  private ws: WebSocket | null = null;
  private config: RunnerWebSocketConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private isIntentionallyClosed = false;

  constructor(config: RunnerWebSocketConfig) {
    this.config = config;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.warn('WebSocket is already connected');
      return;
    }

    this.isIntentionallyClosed = false;

    // Build WebSocket URL with token if provided
    let url = this.config.url;
    if (this.config.token) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}token=${encodeURIComponent(this.config.token)}`;
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('Runner WebSocket connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.config.onConnect?.();
      };

      this.ws.onclose = (event) => {
        console.log('Runner WebSocket disconnected', event.code, event.reason);
        this.config.onDisconnect?.();

        // Attempt to reconnect if not intentionally closed
        if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(
            `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
          );

          setTimeout(() => {
            this.connect();
          }, this.reconnectDelay);

          // Exponential backoff
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Max 30 seconds
        }
      };

      this.ws.onerror = (error) => {
        console.debug('Runner WebSocket error (runner may not be running):', error);
        this.config.onError?.(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.config.onError?.(error as Event);
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a message to the server
   */
  send(message: Record<string, any>): void {
    if (!this.isConnected()) {
      console.error('Cannot send message: WebSocket is not connected');
      return;
    }

    try {
      this.ws?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case 'session_start':
        this.config.onSessionStart?.(message as unknown as SessionStartEvent);
        break;

      case 'screenshot':
        this.config.onScreenshot?.(message as unknown as ScreenshotEvent);
        break;

      case 'log':
        this.config.onLog?.(message as unknown as LogEvent);
        break;

      case 'session_end':
        this.config.onSessionEnd?.(message as unknown as SessionEndEvent);
        break;

      case 'response':
        // Server acknowledgment
        console.log('Server response:', message);
        break;

      case 'error':
        console.error('Server error:', message);
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }
}

/**
 * Create a runner WebSocket connection
 */
export function createRunnerWebSocket(config: RunnerWebSocketConfig): RunnerWebSocket {
  return new RunnerWebSocket(config);
}
