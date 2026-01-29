/**
 * UI Bridge Server Handlers
 *
 * Implements UIBridgeServerHandlers for Next.js API routes.
 * These handlers connect to the global UIBridgeRegistry on the client side.
 *
 * Architecture:
 * - Server-side handlers receive requests from external clients (runner, Python)
 * - For read-only operations, handlers return cached state
 * - For actions, commands are relayed to the browser via WebSocket (preferred) or HTTP polling
 * - Browser executes commands and sends responses back
 *
 * Transport Priority:
 * 1. WebSocket - If client is connected via WebSocket, commands are sent instantly
 * 2. HTTP Polling - Fallback when WebSocket is unavailable
 */

import type { UIBridgeServerHandlers, RenderLogQuery, APIResponse } from "ui-bridge-server";
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  DiscoveryRequest,
  DiscoveryResponse,
  FindRequest,
  FindResponse,
  WorkflowRunRequest,
  WorkflowRunResponse,
  ControlSnapshot,
} from "ui-bridge/control";
import type { RenderLogEntry } from "ui-bridge/render-log";
import type {
  SearchCriteria,
  SearchResponse,
  NLActionRequest,
  NLActionResponse,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,
  SemanticSnapshot,
  SemanticDiff,
} from "ui-bridge/ai";

/**
 * Create a success response wrapper
 */
function success<T>(data: T): APIResponse<T> {
  return {
    success: true,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create an error response wrapper
 */
function error(message: string, code?: string): APIResponse<never> {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now(),
  };
}

// ============================================================================
// In-Memory State Storage
// ============================================================================

// Render log entries (server-side cache)
let renderLogEntries: RenderLogEntry[] = [];
const MAX_ENTRIES = 1000;

// Latest control snapshot from browser (synchronized via WebSocket)
let latestControlSnapshot: ControlSnapshot = {
  timestamp: Date.now(),
  elements: [],
  components: [],
  workflows: [],
  activeRuns: [],
};

// Latest semantic snapshot from browser
let latestSemanticSnapshot: SemanticSnapshot | null = null;

// Pending command responses (command_id -> resolver)
const pendingCommands = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();

// Command timeout in milliseconds (10 seconds for WebSocket, 30 seconds for HTTP)
const WEBSOCKET_COMMAND_TIMEOUT_MS = 10000;
const HTTP_COMMAND_TIMEOUT_MS = 30000;

// ============================================================================
// WebSocket Client Registry
// ============================================================================

/**
 * WebSocket client interface for sending commands
 */
export interface WebSocketClient {
  /**
   * Unique client identifier
   */
  clientId: string;

  /**
   * Send a message to the client
   */
  send: (message: string) => void;

  /**
   * Check if the client is still connected
   */
  isConnected: () => boolean;

  /**
   * Close the connection
   */
  close: () => void;
}

/**
 * WebSocket client registry entry
 */
interface WebSocketClientEntry {
  client: WebSocketClient;
  connectedAt: number;
  lastActivity: number;
}

// WebSocket clients registry (clientId -> entry)
const wsClients = new Map<string, WebSocketClientEntry>();

/**
 * Register a WebSocket client
 */
export function registerWebSocketClient(client: WebSocketClient): void {
  const now = Date.now();
  wsClients.set(client.clientId, {
    client,
    connectedAt: now,
    lastActivity: now,
  });
  console.log(`[UIBridge] WebSocket client registered: ${client.clientId}`);
}

/**
 * Unregister a WebSocket client
 */
export function unregisterWebSocketClient(clientId: string): void {
  wsClients.delete(clientId);
  console.log(`[UIBridge] WebSocket client unregistered: ${clientId}`);
}

/**
 * Update client activity timestamp
 */
export function updateClientActivity(clientId: string): void {
  const entry = wsClients.get(clientId);
  if (entry) {
    entry.lastActivity = Date.now();
  }
}

/**
 * Get the number of connected WebSocket clients
 */
export function getWebSocketClientCount(): number {
  // Clean up disconnected clients
  for (const [clientId, entry] of wsClients.entries()) {
    if (!entry.client.isConnected()) {
      wsClients.delete(clientId);
    }
  }
  return wsClients.size;
}

/**
 * Get a connected WebSocket client (returns first connected client)
 */
function getConnectedClient(): WebSocketClientEntry | null {
  for (const [clientId, entry] of wsClients.entries()) {
    if (entry.client.isConnected()) {
      return entry;
    } else {
      // Clean up disconnected client
      wsClients.delete(clientId);
    }
  }
  return null;
}

/**
 * Send a command via WebSocket to a connected client
 * Returns true if command was sent, false if no client available
 */
function sendCommandViaWebSocket(
  commandId: string,
  action: string,
  payload: unknown
): boolean {
  const clientEntry = getConnectedClient();
  if (!clientEntry) {
    return false;
  }

  try {
    const message = JSON.stringify({
      type: "command",
      commandId,
      action,
      payload,
      timestamp: Date.now(),
    });

    clientEntry.client.send(message);
    clientEntry.lastActivity = Date.now();
    return true;
  } catch (e) {
    console.error(`[UIBridge] Failed to send WebSocket command:`, e);
    return false;
  }
}

/**
 * Broadcast an event to all connected WebSocket clients
 */
export function broadcastEvent(eventType: string, data: unknown): void {
  const message = JSON.stringify({
    type: eventType,
    data,
    timestamp: Date.now(),
  });

  for (const [clientId, entry] of wsClients.entries()) {
    if (entry.client.isConnected()) {
      try {
        entry.client.send(message);
        entry.lastActivity = Date.now();
      } catch (e) {
        console.error(`[UIBridge] Failed to broadcast to ${clientId}:`, e);
        wsClients.delete(clientId);
      }
    } else {
      wsClients.delete(clientId);
    }
  }
}

// ============================================================================
// Command Queue for Browser Relay
// ============================================================================

/**
 * Generate a unique command ID
 */
function generateCommandId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Queue a command to be executed in the browser.
 * Prefers WebSocket delivery when a client is connected, falls back to HTTP polling.
 * Returns a promise that resolves when the browser sends back the response.
 */
export function queueCommand<T>(
  action: string,
  payload: unknown
): Promise<T> {
  const commandId = generateCommandId();

  return new Promise((resolve, reject) => {
    // Try WebSocket delivery first
    const sentViaWebSocket = sendCommandViaWebSocket(commandId, action, payload);

    // Set timeout based on transport method
    const timeoutMs = sentViaWebSocket ? WEBSOCKET_COMMAND_TIMEOUT_MS : HTTP_COMMAND_TIMEOUT_MS;
    const transport = sentViaWebSocket ? "WebSocket" : "HTTP";

    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Command ${action} timed out after ${timeoutMs}ms (${transport})`));
    }, timeoutMs);

    // Store the pending command
    pendingCommands.set(commandId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    // If WebSocket delivery failed, add to HTTP polling queue
    if (!sentViaWebSocket) {
      commandQueue.push({
        commandId,
        action,
        payload,
        timestamp: Date.now(),
      });

      // Limit queue size
      while (commandQueue.length > 100) {
        const dropped = commandQueue.shift();
        if (dropped) {
          const pending = pendingCommands.get(dropped.commandId);
          if (pending) {
            clearTimeout(pending.timeout);
            pending.reject(new Error("Command dropped from queue"));
            pendingCommands.delete(dropped.commandId);
          }
        }
      }
    }
  });
}

/**
 * Resolve a pending command with a response from the browser
 */
export function resolveCommand(commandId: string, result: unknown): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  pending.resolve(result);
  return true;
}

/**
 * Reject a pending command with an error
 */
export function rejectCommand(commandId: string, errorMessage: string): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  pending.reject(new Error(errorMessage));
  return true;
}

// Command queue for browser to poll
interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

const commandQueue: QueuedCommand[] = [];

/**
 * Get pending commands for the browser to execute
 */
export function getPendingCommands(): QueuedCommand[] {
  return commandQueue.splice(0, commandQueue.length);
}

// ============================================================================
// Snapshot Synchronization
// ============================================================================

/**
 * Update the control snapshot (called from browser via sync endpoint)
 */
export function updateControlSnapshot(snapshot: ControlSnapshot): void {
  latestControlSnapshot = snapshot;
}

/**
 * Update the semantic snapshot (called from browser via sync endpoint)
 */
export function updateSemanticSnapshot(snapshot: SemanticSnapshot): void {
  latestSemanticSnapshot = snapshot;
}

// ============================================================================
// Render Log Management
// ============================================================================

/**
 * Add a render log entry (called from client via API)
 */
export function addRenderLogEntry(entry: RenderLogEntry): void {
  renderLogEntries.push(entry);
  while (renderLogEntries.length > MAX_ENTRIES) {
    renderLogEntries.shift();
  }
}

/**
 * Bulk add render log entries
 */
export function addRenderLogEntries(entries: RenderLogEntry[]): void {
  for (const entry of entries) {
    addRenderLogEntry(entry);
  }
}

// ============================================================================
// UI Bridge Server Handlers Implementation
// ============================================================================

export const uiBridgeHandlers: UIBridgeServerHandlers = {
  // --------------------------------------------------------------------------
  // Render Log Endpoints
  // --------------------------------------------------------------------------

  async getRenderLog(query?: RenderLogQuery): Promise<APIResponse<RenderLogEntry[]>> {
    let results = [...renderLogEntries];

    if (query?.type) {
      results = results.filter((e) => e.type === query.type);
    }
    if (query?.since) {
      results = results.filter((e) => e.timestamp >= query.since!);
    }
    if (query?.until) {
      results = results.filter((e) => e.timestamp <= query.until!);
    }
    if (query?.limit) {
      results = results.slice(-query.limit);
    }

    return success(results);
  },

  async clearRenderLog(): Promise<APIResponse<void>> {
    renderLogEntries = [];
    return success(undefined);
  },

  async captureSnapshot(): Promise<APIResponse<unknown>> {
    try {
      const result = await queueCommand("captureSnapshot", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getRenderLogPath(): Promise<APIResponse<{ path: string }>> {
    return success({ path: "/api/ui-bridge/render-log" });
  },

  // --------------------------------------------------------------------------
  // Control - Elements
  // --------------------------------------------------------------------------

  async getElements(): Promise<APIResponse<ControlSnapshot["elements"]>> {
    return success(latestControlSnapshot.elements);
  },

  async getElement(id: string): Promise<APIResponse<ControlSnapshot["elements"][0]>> {
    const element = latestControlSnapshot.elements.find((e) => e.id === id);
    if (!element) {
      return error(`Element ${id} not found`, "NOT_FOUND");
    }
    return success(element);
  },

  async getElementState(id: string): Promise<APIResponse<unknown>> {
    try {
      const result = await queueCommand("getElementState", { id });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async executeElementAction(
    id: string,
    request: ControlActionRequest
  ): Promise<APIResponse<ControlActionResponse>> {
    try {
      const result = await queueCommand<ControlActionResponse>("executeElementAction", {
        id,
        request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Control - Components
  // --------------------------------------------------------------------------

  async getComponents(): Promise<APIResponse<ControlSnapshot["components"]>> {
    return success(latestControlSnapshot.components);
  },

  async getComponent(id: string): Promise<APIResponse<ControlSnapshot["components"][0]>> {
    const component = latestControlSnapshot.components.find((c) => c.id === id);
    if (!component) {
      return error(`Component ${id} not found`, "NOT_FOUND");
    }
    return success(component);
  },

  async executeComponentAction(
    id: string,
    request: ComponentActionRequest
  ): Promise<APIResponse<ComponentActionResponse>> {
    try {
      const result = await queueCommand<ComponentActionResponse>("executeComponentAction", {
        id,
        request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Find / Discovery
  // --------------------------------------------------------------------------

  async find(request?: FindRequest): Promise<APIResponse<FindResponse>> {
    try {
      const result = await queueCommand<FindResponse>("find", request || {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async discover(request?: DiscoveryRequest): Promise<APIResponse<DiscoveryResponse>> {
    // Deprecated - use find
    try {
      const result = await queueCommand<DiscoveryResponse>("discover", request || {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getControlSnapshot(): Promise<APIResponse<ControlSnapshot>> {
    // Request fresh snapshot from browser
    try {
      const result = await queueCommand<ControlSnapshot>("getControlSnapshot", {});
      updateControlSnapshot(result);
      return success(result);
    } catch (e) {
      // Fall back to cached snapshot
      return success(latestControlSnapshot);
    }
  },

  // --------------------------------------------------------------------------
  // Workflows
  // --------------------------------------------------------------------------

  async getWorkflows(): Promise<APIResponse<ControlSnapshot["workflows"]>> {
    return success(latestControlSnapshot.workflows);
  },

  async runWorkflow(
    id: string,
    request?: WorkflowRunRequest
  ): Promise<APIResponse<WorkflowRunResponse>> {
    try {
      const result = await queueCommand<WorkflowRunResponse>("runWorkflow", {
        id,
        request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getWorkflowStatus(runId: string): Promise<APIResponse<WorkflowRunResponse>> {
    try {
      const result = await queueCommand<WorkflowRunResponse>("getWorkflowStatus", { runId });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Debug
  // --------------------------------------------------------------------------

  async getActionHistory(_limit?: number): Promise<APIResponse<unknown[]>> {
    try {
      const result = await queueCommand<unknown[]>("getActionHistory", { limit: _limit });
      return success(result);
    } catch (e) {
      return success([]); // Fall back to empty
    }
  },

  async getMetrics(): Promise<APIResponse<unknown>> {
    return success({
      timestamp: Date.now(),
      uptime: process.uptime() * 1000,
      memory: process.memoryUsage(),
      pendingCommands: pendingCommands.size,
      commandQueueLength: commandQueue.length,
    });
  },

  async highlightElement(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("highlightElement", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getElementTree(): Promise<APIResponse<unknown>> {
    try {
      const result = await queueCommand("getElementTree", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // AI-Native Endpoints
  // --------------------------------------------------------------------------

  async aiSearch(criteria: SearchCriteria): Promise<APIResponse<SearchResponse>> {
    try {
      const result = await queueCommand<SearchResponse>("aiSearch", criteria);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiExecute(request: NLActionRequest): Promise<APIResponse<NLActionResponse>> {
    try {
      const result = await queueCommand<NLActionResponse>("aiExecute", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiAssert(request: AssertionRequest): Promise<APIResponse<AssertionResult>> {
    try {
      const result = await queueCommand<AssertionResult>("aiAssert", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiAssertBatch(
    request: BatchAssertionRequest
  ): Promise<APIResponse<BatchAssertionResult>> {
    try {
      const result = await queueCommand<BatchAssertionResult>("aiAssertBatch", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getSemanticSnapshot(): Promise<APIResponse<SemanticSnapshot>> {
    try {
      const result = await queueCommand<SemanticSnapshot>("getSemanticSnapshot", {});
      updateSemanticSnapshot(result);
      return success(result);
    } catch (e) {
      // Fall back to cached snapshot
      if (latestSemanticSnapshot) {
        return success(latestSemanticSnapshot);
      }
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getSemanticDiff(since?: number): Promise<APIResponse<SemanticDiff | null>> {
    try {
      const result = await queueCommand<SemanticDiff | null>("getSemanticDiff", { since });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getPageSummary(): Promise<APIResponse<string>> {
    try {
      const result = await queueCommand<string>("getPageSummary", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Component State Endpoint
  // --------------------------------------------------------------------------

  async getComponentState(id: string): Promise<APIResponse<{ state: Record<string, unknown>; computed: Record<string, unknown>; timestamp: number }>> {
    try {
      const result = await queueCommand<{ state: Record<string, unknown>; computed: Record<string, unknown>; timestamp: number }>("getComponentState", { id });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Semantic Search Endpoint
  // --------------------------------------------------------------------------

  async aiSemanticSearch(criteria: { query: string; threshold?: number; limit?: number; type?: string; role?: string; combineWithText?: boolean }): Promise<APIResponse<{ results: unknown[]; bestMatch: unknown | null; scannedCount: number; durationMs: number; query: string; timestamp: number }>> {
    try {
      const result = await queueCommand<{ results: unknown[]; bestMatch: unknown | null; scannedCount: number; durationMs: number; query: string; timestamp: number }>("aiSemanticSearch", criteria);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },
};
