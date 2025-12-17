/**
 * Backend API Client - Communicates with qontinui Python backend
 *
 * This client provides methods for:
 * - Executing workflows
 * - Managing execution lifecycle (pause, resume, cancel)
 * - Streaming execution events via WebSocket
 * - Querying execution status and history
 *
 * Architecture:
 * - RESTful API for control operations
 * - WebSocket for real-time event streaming
 * - Automatic retry and reconnection logic
 * - Type-safe interfaces for all operations
 */

import type { Workflow } from "@/lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

/**
 * Execution status enum
 */
export type ExecutionStatus =
  | "pending"
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Execution event types
 */
export type ExecutionEventType =
  | "workflow_start"
  | "workflow_complete"
  | "workflow_error"
  | "action_start"
  | "action_complete"
  | "action_error"
  | "action_skip"
  | "breakpoint"
  | "variable_update"
  | "log";

/**
 * Action execution state
 */
export type ActionExecutionStatus =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/**
 * Options for workflow execution
 */
export interface ExecutionOptions {
  /** Initial variables to pass to workflow */
  initialVariables?: Record<string, unknown>;

  /** Enable debug mode */
  debugMode?: boolean;

  /** Action IDs to pause at (breakpoints) */
  breakpoints?: string[];

  /** Enable step-by-step execution */
  stepMode?: boolean;

  /** Maximum execution time in seconds (0 = unlimited) */
  timeout?: number;

  /** Continue execution on action errors */
  continueOnError?: boolean;
}

/**
 * Execution handle returned when starting execution
 */
export interface ExecutionHandle {
  /** Unique execution ID */
  executionId: string;

  /** Workflow ID being executed */
  workflowId: string;

  /** Workflow name */
  workflowName: string;

  /** Execution start time */
  startTime: Date;

  /** Current execution status */
  status: ExecutionStatus;

  /** WebSocket URL for event streaming */
  streamUrl: string;
}

/**
 * Detailed execution status
 */
export interface ExecutionStatusDetail {
  /** Execution ID */
  executionId: string;

  /** Workflow ID */
  workflowId: string;

  /** Current status */
  status: ExecutionStatus;

  /** Start time */
  startTime: Date;

  /** End time (if completed/failed/cancelled) */
  endTime?: Date;

  /** Current action being executed */
  currentAction?: string;

  /** Progress (0-100) */
  progress: number;

  /** Total number of actions */
  totalActions: number;

  /** Number of completed actions */
  completedActions: number;

  /** Number of failed actions */
  failedActions: number;

  /** Number of skipped actions */
  skippedActions: number;

  /** Action states */
  actionStates: Record<string, ActionExecutionStatus>;

  /** Error information if failed */
  error?: {
    message: string;
    actionId?: string;
    timestamp: Date;
    stack?: string;
  };

  /** Current context variables */
  variables?: Record<string, unknown>;
}

/**
 * Execution event
 */
export interface ExecutionEvent {
  /** Event type */
  type: ExecutionEventType;

  /** Execution ID */
  executionId: string;

  /** Event timestamp */
  timestamp: Date;

  /** Action ID (for action-related events) */
  actionId?: string;

  /** Action type */
  actionType?: string;

  /** Event data */
  data?: {
    /** Success flag (for completion events) */
    success?: boolean;

    /** Error message */
    error?: string;

    /** Error stack trace */
    stack?: string;

    /** Result data */
    result?: unknown;

    /** Variable updates */
    variables?: Record<string, unknown>;

    /** Log message */
    message?: string;

    /** Log level */
    level?: "debug" | "info" | "warning" | "error";

    /** Execution duration (ms) */
    duration?: number;

    /** Additional metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Execution record (history entry)
 */
export interface ExecutionRecord {
  /** Execution ID */
  executionId: string;

  /** Workflow ID */
  workflowId: string;

  /** Workflow name */
  workflowName: string;

  /** Start time */
  startTime: Date;

  /** End time */
  endTime: Date;

  /** Final status */
  status: ExecutionStatus;

  /** Execution duration (ms) */
  duration: number;

  /** Total actions */
  totalActions: number;

  /** Completed actions */
  completedActions: number;

  /** Failed actions */
  failedActions: number;

  /** Error summary */
  error?: string;
}

/**
 * API error response
 */
export interface ApiError {
  /** Error message */
  message: string;

  /** Error code */
  code?: string;

  /** HTTP status code */
  status?: number;

  /** Additional details */
  details?: unknown;
}

// ============================================================================
// Backend API Client
// ============================================================================

/**
 * Backend API client configuration
 */
export interface BackendAPIConfig {
  /** Base URL for HTTP API */
  baseUrl: string;

  /** WebSocket base URL */
  wsUrl: string;

  /** Request timeout (ms) */
  timeout?: number;

  /** Number of retry attempts */
  retries?: number;

  /** Retry delay (ms) */
  retryDelay?: number;

  /** Authentication token */
  authToken?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: BackendAPIConfig = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000",
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
};

/**
 * Backend API Client
 *
 * Provides methods to interact with the qontinui Python backend for
 * workflow execution and management.
 */
export class BackendAPI {
  private config: BackendAPIConfig;
  private activeWebSockets: Map<string, WebSocket>;

  constructor(config?: Partial<BackendAPIConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeWebSockets = new Map();
  }

  // ==========================================================================
  // HTTP API Methods
  // ==========================================================================

  /**
   * Execute a workflow
   *
   * Starts workflow execution and returns an execution handle with
   * execution ID and WebSocket URL for streaming events.
   *
   * @param workflow - Workflow to execute
   * @param options - Execution options
   * @returns Execution handle
   * @throws ApiError if execution fails to start
   */
  async executeWorkflow(
    workflow: Workflow,
    options?: ExecutionOptions
  ): Promise<ExecutionHandle> {
    const response = await this.request<{
      execution_id: string;
      workflow_id: string;
      workflow_name: string;
      start_time: string;
      status: string;
      stream_url: string;
    }>("/api/execute", {
      method: "POST",
      body: {
        workflow,
        options: options || {},
      },
    });

    return {
      executionId: response.execution_id,
      workflowId: response.workflow_id,
      workflowName: response.workflow_name,
      startTime: new Date(response.start_time),
      status: response.status as ExecutionStatus,
      streamUrl: response.stream_url,
    };
  }

  /**
   * Get execution status
   *
   * Retrieves detailed status information for a running or completed execution.
   *
   * @param executionId - Execution ID
   * @returns Detailed execution status
   * @throws ApiError if execution not found
   */
  async getExecutionStatus(
    executionId: string
  ): Promise<ExecutionStatusDetail> {
    const response = await this.request<unknown>(
      `/api/execution/${executionId}/status`,
      { method: "GET" }
    );
    const responseRecord = response as Record<string, unknown>;

    return {
      executionId: responseRecord.execution_id as string,
      workflowId: responseRecord.workflow_id as string,
      status: responseRecord.status as string,
      startTime: new Date(responseRecord.start_time as string),
      endTime: responseRecord.end_time
        ? new Date(responseRecord.end_time as string)
        : undefined,
      currentAction: responseRecord.current_action as string | undefined,
      progress: responseRecord.progress as number,
      totalActions: responseRecord.total_actions as number,
      completedActions: responseRecord.completed_actions as number,
      failedActions: responseRecord.failed_actions as number,
      skippedActions: responseRecord.skipped_actions as number,
      actionStates: responseRecord.action_states as unknown[],
      error: responseRecord.error
        ? {
            message: (responseRecord.error as Record<string, unknown>)
              .message as string,
            actionId: (responseRecord.error as Record<string, unknown>)
              .action_id as string,
            timestamp: new Date(
              (responseRecord.error as Record<string, unknown>)
                .timestamp as string
            ),
            stack: (responseRecord.error as Record<string, unknown>)
              .stack as string,
          }
        : undefined,
      variables: responseRecord.variables as Record<string, unknown>,
    };
  }

  /**
   * Pause execution
   *
   * Pauses a running execution. The execution can be resumed later.
   *
   * @param executionId - Execution ID
   * @throws ApiError if execution cannot be paused
   */
  async pauseExecution(executionId: string): Promise<void> {
    await this.request(`/api/execution/${executionId}/pause`, {
      method: "POST",
    });
  }

  /**
   * Resume execution
   *
   * Resumes a paused execution.
   *
   * @param executionId - Execution ID
   * @throws ApiError if execution cannot be resumed
   */
  async resumeExecution(executionId: string): Promise<void> {
    await this.request(`/api/execution/${executionId}/resume`, {
      method: "POST",
    });
  }

  /**
   * Step execution
   *
   * Execute the next action in step mode.
   *
   * @param executionId - Execution ID
   * @throws ApiError if execution cannot be stepped
   */
  async stepExecution(executionId: string): Promise<void> {
    await this.request(`/api/execution/${executionId}/step`, {
      method: "POST",
    });
  }

  /**
   * Cancel execution
   *
   * Cancels a running or paused execution.
   *
   * @param executionId - Execution ID
   * @throws ApiError if execution cannot be cancelled
   */
  async cancelExecution(executionId: string): Promise<void> {
    await this.request(`/api/execution/${executionId}/cancel`, {
      method: "POST",
    });

    // Close WebSocket if active
    const ws = this.activeWebSockets.get(executionId);
    if (ws) {
      ws.close();
      this.activeWebSockets.delete(executionId);
    }
  }

  /**
   * Get execution history
   *
   * Retrieves execution history for a workflow.
   *
   * @param workflowId - Workflow ID
   * @param limit - Maximum number of records to return
   * @returns Array of execution records
   */
  async getExecutionHistory(
    workflowId: string,
    limit?: number
  ): Promise<ExecutionRecord[]> {
    const params = new URLSearchParams();
    if (limit) {
      params.set("limit", limit.toString());
    }

    const response = await this.request<unknown[]>(
      `/api/workflow/${workflowId}/history?${params}`,
      { method: "GET" }
    );

    return response.map((record) => {
      const r = record as Record<string, unknown>;
      return {
        executionId: r.execution_id as string,
        workflowId: r.workflow_id as string,
        workflowName: r.workflow_name as string,
        startTime: new Date(r.start_time as string),
        endTime: new Date(r.end_time as string),
        status: r.status as string,
        duration: r.duration as number,
        totalActions: r.total_actions as number,
        completedActions: r.completed_actions as number,
        failedActions: r.failed_actions as number,
        error: r.error as string | undefined,
      };
    });
  }

  /**
   * Get all executions
   *
   * Retrieves all executions (active and historical).
   *
   * @param limit - Maximum number of records to return
   * @returns Array of execution records
   */
  async getAllExecutions(limit?: number): Promise<ExecutionRecord[]> {
    const params = new URLSearchParams();
    if (limit) {
      params.set("limit", limit.toString());
    }

    const response = await this.request<unknown[]>(`/api/executions?${params}`, {
      method: "GET",
    });

    return response.map((record) => {
      const r = record as Record<string, unknown>;
      return {
        executionId: r.execution_id as string,
        workflowId: r.workflow_id as string,
        workflowName: r.workflow_name as string,
        startTime: new Date(r.start_time as string),
        endTime: new Date(r.end_time as string),
        status: r.status as string,
        duration: r.duration as number,
        totalActions: r.total_actions as number,
        completedActions: r.completed_actions as number,
        failedActions: r.failed_actions as number,
        error: r.error as string | undefined,
      };
    });
  }

  // ==========================================================================
  // WebSocket Streaming
  // ==========================================================================

  /**
   * Stream execution events via WebSocket
   *
   * Establishes a WebSocket connection to receive real-time execution events.
   * Returns a cleanup function to close the connection.
   *
   * @param executionId - Execution ID
   * @param onEvent - Callback for each event
   * @param onError - Callback for errors (optional)
   * @param onClose - Callback when connection closes (optional)
   * @returns Cleanup function to close the WebSocket
   */
  streamExecutionEvents(
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    onError?: (error: Error) => void,
    onClose?: () => void
  ): () => void {
    // Close existing WebSocket for this execution
    const existingWs = this.activeWebSockets.get(executionId);
    if (existingWs) {
      existingWs.close();
    }

    // Create WebSocket URL
    const wsUrl = `${this.config.wsUrl}/api/execution/${executionId}/stream`;

    // Create WebSocket connection
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[BackendAPI] WebSocket connected: ${executionId}`);
    };

    ws.onmessage = (messageEvent) => {
      try {
        const data = JSON.parse(messageEvent.data);

        // Parse event
        const event: ExecutionEvent = {
          type: data.type,
          executionId: data.execution_id,
          timestamp: new Date(data.timestamp),
          actionId: data.action_id,
          actionType: data.action_type,
          data: data.data,
        };

        onEvent(event);
      } catch (error) {
        console.error("[BackendAPI] Error parsing WebSocket message:", error);
        if (onError) {
          onError(error as Error);
        }
      }
    };

    ws.onerror = (event) => {
      console.error("[BackendAPI] WebSocket error:", event);
      if (onError) {
        onError(new Error("WebSocket error"));
      }
    };

    ws.onclose = () => {
      console.log(`[BackendAPI] WebSocket closed: ${executionId}`);
      this.activeWebSockets.delete(executionId);
      if (onClose) {
        onClose();
      }
    };

    // Store WebSocket
    this.activeWebSockets.set(executionId, ws);

    // Return cleanup function
    return () => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
      this.activeWebSockets.delete(executionId);
    };
  }

  /**
   * Close all active WebSocket connections
   */
  closeAllStreams(): void {
    for (const [executionId, ws] of this.activeWebSockets.entries()) {
      ws.close();
      this.activeWebSockets.delete(executionId);
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * Check if backend is available
   *
   * @returns True if backend is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request("/api/health", { method: "GET" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get backend version information
   *
   * @returns Version information
   */
  async getVersion(): Promise<{
    version: string;
    apiVersion: string;
    pythonVersion: string;
  }> {
    return await this.request("/api/version", { method: "GET" });
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Make HTTP request with retry logic
   */
  private async request<T>(
    endpoint: string,
    options: {
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= (this.config.retries || 0); attempt++) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...options.headers,
        };

        if (this.config.authToken) {
          headers["Authorization"] = `Bearer ${this.config.authToken}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout || 30000
        );

        const response = await fetch(url, {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw this.createApiError(
            errorData.message ||
              `HTTP ${response.status}: ${response.statusText}`,
            errorData.code,
            response.status,
            errorData.details
          );
        }

        // Handle empty responses
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return await response.json();
        } else {
          return {} as T;
        }
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error instanceof Error && "status" in error) {
          const apiError = error as ApiError;
          if (
            apiError.status &&
            apiError.status >= 400 &&
            apiError.status < 500
          ) {
            throw error;
          }
        }

        // Retry on network errors or server errors (5xx)
        if (attempt < (this.config.retries || 0)) {
          await this.delay(this.config.retryDelay || 1000);
          continue;
        }
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Create API error object
   */
  private createApiError(
    message: string,
    code?: string,
    status?: number,
    details?: unknown
  ): ApiError {
    const error = new Error(message) as ApiError;
    error.message = message;
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default backend API instance
 */
export const backendAPI = new BackendAPI();

/**
 * Create a new backend API instance with custom configuration
 */
export function createBackendAPI(
  config: Partial<BackendAPIConfig>
): BackendAPI {
  return new BackendAPI(config);
}
