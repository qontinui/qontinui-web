/**
 * WebSocket client for real-time runner connection
 *
 * This client allows the web UI to monitor automation sessions in real-time,
 * receiving screenshots, logs, and status updates as the runner executes automations.
 */

/**
 * UI Bridge command received via WebSocket
 */
export interface UIBridgeCommandEvent {
  type: "ui_bridge_command";
  command_id: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * UI Bridge command handler function type
 */
export type UIBridgeCommandHandler = (
  action: string,
  payload: Record<string, unknown>
) => Promise<unknown>;

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
  // Web extraction events
  onExtractionStarted?: (data: ExtractionStartedEvent) => void;
  onExtractionProgress?: (data: ExtractionProgressEvent) => void;
  onExtractionStateDetected?: (data: ExtractionStateDetectedEvent) => void;
  onExtractionElementDetected?: (data: ExtractionElementDetectedEvent) => void;
  onExtractionTransitionDetected?: (
    data: ExtractionTransitionDetectedEvent
  ) => void;
  onExtractionComplete?: (data: ExtractionCompleteEvent) => void;
  onExtractionError?: (data: ExtractionErrorEvent) => void;
  // Command response callback
  onCommandResponse?: (data: CommandResponseEvent) => void;
  // UI Bridge command handler for WebSocket-based commands
  uiBridgeCommandHandler?: UIBridgeCommandHandler;
}

export interface CommandResponseEvent {
  command: string;
  result: {
    success: boolean;
    extraction_id?: string;
    error?: string;
    [key: string]: unknown;
  };
  timestamp: string;
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
  level: "debug" | "info" | "warning" | "error" | "critical";
  message: string;
  log_data?: Record<string, unknown>;
  sequence_number: number;
  timestamp: string;
}

export interface SessionEndEvent {
  session_id: string;
  status: "completed" | "failed" | "disconnected";
  error_message?: string;
  timestamp: string;
}

// Web extraction events
export interface ExtractionStartedEvent {
  extraction_id: string;
  config: {
    urls: string[];
    viewports: [number, number][];
  };
  // New architecture fields
  mode?: "static_only" | "black_box" | "white_box";
  framework?: string;
  app_id?: string;
  app_name?: string;
  timestamp: string;
}

export interface ExtractionProgressEvent {
  extraction_id: string;
  current_url: string;
  pages_visited: number;
  states_found: number;
  elements_found: number;
  // New architecture fields
  phase?: "static_analysis" | "runtime_extraction" | "correlation";
  phase_progress?: number; // 0-100
  timestamp: string;
}

export interface ExtractionStateDetectedEvent {
  extraction_id: string;
  state: {
    id: string;
    name: string;
    state_type: string;
    bbox: { x: number; y: number; width: number; height: number };
    screenshot_id: string;
    element_ids: string[];
    // New architecture fields (correlated state)
    source_component?: string;
    controlling_variables?: string[];
    conditions?: string[];
    source_file?: string;
    source_line?: number;
    route?: string;
    confidence?: number;
    match_evidence?: Array<{
      evidence_type: string;
      description: string;
      strength: number;
    }>;
  };
  thumbnail: string; // base64
  timestamp: string;
}

export interface ExtractionElementDetectedEvent {
  extraction_id: string;
  element: {
    id: string;
    element_type: string;
    bbox: { x: number; y: number; width: number; height: number };
    text?: string;
    tag_name: string;
    // New architecture fields
    selector?: string;
    is_interactive?: boolean;
    is_enabled?: boolean;
    is_visible?: boolean;
    semantic_role?: string;
    aria_label?: string;
  };
  timestamp: string;
}

export interface ExtractionTransitionDetectedEvent {
  extraction_id: string;
  transition: {
    id: string;
    trigger_handler?: string;
    action_type?: string;
    state_before?: string;
    state_after?: string;
    causes_appear?: string[];
    causes_disappear?: string[];
    confidence: number;
    verified?: boolean;
    trigger_element?: string;
    trigger_selector?: string;
  };
  timestamp: string;
}

export interface ExtractionCompleteEvent {
  extraction_id: string;
  summary: {
    total_pages: number;
    total_states: number;
    total_elements: number;
    total_transitions: number;
  };
  // New architecture fields
  mode?: "static_only" | "black_box" | "white_box";
  framework?: string;
  application_state?: {
    app_id: string;
    app_name: string;
    app_type: string;
    framework: string;
    states: unknown[];
    transitions: unknown[];
    elements: unknown[];
  };
  composite_state?: {
    id: string;
    name: string;
    applications: Record<string, unknown>;
  };
  timestamp: string;
}

export interface ExtractionErrorEvent {
  extraction_id: string;
  error: string;
  // New architecture fields
  phase?: "static_analysis" | "runtime_extraction" | "correlation";
  recoverable?: boolean;
  timestamp: string;
}

export interface WSMessage {
  type: string;
  timestamp: string;
  [key: string]: unknown;
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
      console.warn("WebSocket is already connected");
      return;
    }

    this.isIntentionallyClosed = false;

    // Build WebSocket URL with token if provided
    let url = this.config.url;
    if (this.config.token) {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}token=${encodeURIComponent(this.config.token)}`;
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log("Runner WebSocket connected");
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.config.onConnect?.();
      };

      this.ws.onclose = (event) => {
        console.log(
          "Runner WebSocket disconnected",
          event.code,
          event.reason,
          "isIntentionallyClosed:",
          this.isIntentionallyClosed
        );
        this.config.onDisconnect?.();

        // Attempt to reconnect if not intentionally closed
        if (
          !this.isIntentionallyClosed &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
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
        console.debug(
          "Runner WebSocket error (runner may not be running):",
          error
        );
        this.config.onError?.(error);
      };

      this.ws.onmessage = (event) => {
        console.log(
          "[RunnerWebSocket] onmessage received, data length:",
          event.data?.length
        );
        try {
          const message: WSMessage = JSON.parse(event.data);
          console.log("[RunnerWebSocket] Parsed message type:", message.type);
          this.handleMessage(message);
        } catch (error) {
          console.error(
            "Failed to parse WebSocket message:",
            error,
            "raw data:",
            event.data
          );
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      this.config.onError?.(error as Event);
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    console.log("[RunnerWebSocket] disconnect() called", new Error().stack);
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
  send(message: Record<string, unknown>): void {
    console.log(
      "[RunnerWebSocket] send() called, isConnected:",
      this.isConnected(),
      "readyState:",
      this.ws?.readyState
    );
    if (!this.isConnected()) {
      console.error(
        "Cannot send message: WebSocket is not connected, readyState:",
        this.ws?.readyState
      );
      return;
    }

    try {
      const jsonMessage = JSON.stringify(message);
      console.log(
        "[RunnerWebSocket] Sending message:",
        message.type,
        message.command
      );
      this.ws?.send(jsonMessage);
      console.log("[RunnerWebSocket] Message sent successfully");
    } catch (error) {
      console.error("Failed to send WebSocket message:", error);
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case "session_start":
        this.config.onSessionStart?.(message as unknown as SessionStartEvent);
        break;

      case "screenshot":
        this.config.onScreenshot?.(message as unknown as ScreenshotEvent);
        break;

      case "log":
        this.config.onLog?.(message as unknown as LogEvent);
        break;

      case "session_end":
        this.config.onSessionEnd?.(message as unknown as SessionEndEvent);
        break;

      // Web extraction events
      case "extraction_started":
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const startedData =
            (message as { data?: ExtractionStartedEvent }).data || message;
          console.log(
            "[RunnerWebSocket] Extraction started event data:",
            startedData
          );
          this.config.onExtractionStarted?.(
            startedData as ExtractionStartedEvent
          );
        }
        break;

      case "extraction_progress":
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const progressData =
            (message as { data?: ExtractionProgressEvent }).data || message;
          this.config.onExtractionProgress?.(
            progressData as ExtractionProgressEvent
          );
        }
        break;

      case "extraction_state_detected":
      case "state_detected": // Raw event name from qontinui library
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const stateData =
            (message as { data?: ExtractionStateDetectedEvent }).data ||
            message;
          console.log(
            "[RunnerWebSocket] State detected event data:",
            stateData
          );
          this.config.onExtractionStateDetected?.(
            stateData as ExtractionStateDetectedEvent
          );
        }
        break;

      case "extraction_element_detected":
      case "element_detected": // Raw event name from qontinui library
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const elementData =
            (message as { data?: ExtractionElementDetectedEvent }).data ||
            message;
          console.log(
            "[RunnerWebSocket] Element detected event data:",
            elementData
          );
          this.config.onExtractionElementDetected?.(
            elementData as ExtractionElementDetectedEvent
          );
        }
        break;

      case "extraction_transition_detected":
      case "transition_detected": // Raw event name from qontinui library
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const transitionData =
            (message as { data?: ExtractionTransitionDetectedEvent }).data ||
            message;
          console.log(
            "[RunnerWebSocket] Transition detected event data:",
            transitionData
          );
          this.config.onExtractionTransitionDetected?.(
            transitionData as ExtractionTransitionDetectedEvent
          );
        }
        break;

      case "extraction_complete":
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const completeData =
            (message as { data?: ExtractionCompleteEvent }).data || message;
          console.log(
            "[RunnerWebSocket] Extraction complete event data:",
            completeData
          );
          this.config.onExtractionComplete?.(
            completeData as ExtractionCompleteEvent
          );
        }
        break;

      case "extraction_error":
        // Data may be wrapped in a 'data' field by the Python websocket handler
        {
          const errorData =
            (message as { data?: ExtractionErrorEvent }).data || message;
          console.log(
            "[RunnerWebSocket] Extraction error event data:",
            errorData
          );
          this.config.onExtractionError?.(errorData as ExtractionErrorEvent);
        }
        break;

      case "response":
        // Server acknowledgment
        console.log("Server response:", message);
        break;

      case "error":
        console.error("Server error:", message);
        break;

      // Command WebSocket messages
      case "connected":
        console.log("[RunnerWebSocket] Connected acknowledgment:", message);
        break;

      case "command_sent":
        console.log("[RunnerWebSocket] Command sent acknowledgment:", message);
        break;

      case "command_response":
        // Response from runner after processing a command
        console.log("[RunnerWebSocket] Command response received:", message);

        // Handle various response formats from different runners
        const responseMsg = message as {
          data?: {
            command?: string;
            result?: {
              success?: boolean;
              extraction_id?: string;
              error?: string;
              [key: string]: unknown;
            };
            response_type?: string;
            [key: string]: unknown;
          };
          timestamp?: string;
        };
        const responseData = responseMsg.data;

        if (responseData) {
          // Try to extract command name from various possible fields
          const command =
            responseData.command || responseData.response_type || "unknown";

          // Build result object, handling cases where result is nested or flat
          const result = responseData.result || {
            success: !responseData.error,
            extraction_id: responseData.extraction_id as string | undefined,
            error: responseData.error as string | undefined,
          };

          console.log(
            "[RunnerWebSocket] Parsed command response - command:",
            command,
            "result:",
            result
          );

          this.config.onCommandResponse?.({
            command,
            result: result as CommandResponseEvent["result"],
            timestamp: responseMsg.timestamp || new Date().toISOString(),
          });
        } else {
          console.warn(
            "[RunnerWebSocket] Command response has no data:",
            message
          );
        }
        break;

      case "warning":
        console.warn("[RunnerWebSocket] Server warning:", message);
        break;

      case "pong":
        console.debug("[RunnerWebSocket] Pong received");
        break;

      case "ping":
        console.debug("[RunnerWebSocket] Ping received");
        break;

      case "ui_bridge_command":
        // UI Bridge command from runner via backend WebSocket
        this.handleUIBridgeCommand(message as unknown as UIBridgeCommandEvent);
        break;

      default:
        console.warn(
          "[RunnerWebSocket] Unknown message type:",
          message.type,
          message
        );
    }
  }

  /**
   * Handle UI Bridge command received via WebSocket
   * Executes the command and sends response back via WebSocket
   */
  private async handleUIBridgeCommand(command: UIBridgeCommandEvent): Promise<void> {
    const { command_id, action, payload } = command;

    console.log(
      "[RunnerWebSocket] UI Bridge command received:",
      action,
      "command_id:",
      command_id
    );

    // Check if handler is configured
    if (!this.config.uiBridgeCommandHandler) {
      console.warn(
        "[RunnerWebSocket] No UI Bridge command handler configured, ignoring command:",
        action
      );
      // Send error response
      this.send({
        type: "ui_bridge_response",
        command_id,
        success: false,
        error: "No UI Bridge command handler configured",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      // Execute the command
      const result = await this.config.uiBridgeCommandHandler(action, payload);

      // Send success response
      this.send({
        type: "ui_bridge_response",
        command_id,
        success: true,
        result,
        timestamp: new Date().toISOString(),
      });

      console.log(
        "[RunnerWebSocket] UI Bridge command completed successfully:",
        action
      );
    } catch (error) {
      // Send error response
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.send({
        type: "ui_bridge_response",
        command_id,
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      console.error(
        "[RunnerWebSocket] UI Bridge command failed:",
        action,
        errorMessage
      );
    }
  }
}

/**
 * Create a runner WebSocket connection
 */
export function createRunnerWebSocket(
  config: RunnerWebSocketConfig
): RunnerWebSocket {
  return new RunnerWebSocket(config);
}
