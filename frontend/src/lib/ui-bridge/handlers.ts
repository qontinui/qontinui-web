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

import type {
  UIBridgeServerHandlers,
  RenderLogQuery,
  APIResponse,
} from "@qontinui/ui-bridge/server";
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  FindRequest,
  FindResponse,
  WorkflowRunRequest,
  WorkflowRunResponse,
  ControlSnapshot,
} from "@qontinui/ui-bridge/control";
import type { RenderLogEntry } from "@qontinui/ui-bridge/render-log";
import type {
  ElementAnnotation,
  AnnotationConfig,
  AnnotationCoverage,
} from "@qontinui/ui-bridge/annotations";
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
  SemanticSearchCriteria,
  SemanticSearchResponse,
  Intent,
  IntentSearchResponse,
  IntentExecutionResult,
  RecoveryAttemptRequest,
  RecoveryAttemptResult,
  PageDataMap,
  PageRegionMap,
  StructuredDataExtraction,
  CrossAppComparisonReport,
  ComponentInfo,
} from "@qontinui/ui-bridge/ai";
import type {
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
} from "@qontinui/ui-bridge/core";
import type { CapturedError } from "@qontinui/ui-bridge/debug";

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
const MAX_ENTRIES = 5; // Each entry is a full DOM snapshot (several MB each)

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

// ============================================================================
// Shared State via globalThis
// ============================================================================
// Next.js dev mode compiles each API route into a separate module graph.
// Module-level variables are duplicated across routes, breaking the command
// relay (SSE stream subscribes to one Set, snapshot handler checks a different
// Set). Using globalThis for commandListeners and pendingCommands ensures all
// routes share the same instances.

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

type CommandListener = (command: QueuedCommand) => void;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__uiBridgePendingCommands) {
  g.__uiBridgePendingCommands = new Map<string, PendingCommand>();
}
if (!g.__uiBridgeCommandListeners) {
  g.__uiBridgeCommandListeners = new Set<CommandListener>();
}

const pendingCommands: Map<string, PendingCommand> =
  g.__uiBridgePendingCommands;
const commandListeners: Set<CommandListener> = g.__uiBridgeCommandListeners;

const MAX_PENDING_COMMANDS = 200;

// Command timeout in milliseconds (10 seconds for WebSocket, 30 seconds for SSE/HTTP)
const WEBSOCKET_COMMAND_TIMEOUT_MS = 10000;
const SSE_COMMAND_TIMEOUT_MS = 15000;

/**
 * Subscribe to new commands. Returns an unsubscribe function.
 * Used by the SSE stream endpoint to push commands to the browser.
 */
export function subscribeToCommands(listener: CommandListener): () => void {
  commandListeners.add(listener);
  console.log(`[ui-bridge] SSE listener connected (total: ${commandListeners.size})`);
  return () => {
    commandListeners.delete(listener);
    console.log(`[ui-bridge] SSE listener disconnected (total: ${commandListeners.size})`);
  };
}

/**
 * Check if any SSE listeners are connected
 */
export function hasCommandListeners(): boolean {
  return commandListeners.size > 0;
}

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

// Commands that cause the page to unload (navigation, refresh) will never
// receive a browser response because the old page dies before it can POST
// back. These are resolved immediately after delivery ("fire-and-forget").
const FIRE_AND_FORGET_COMMANDS = new Set([
  "pageNavigate",
  "pageRefresh",
]);

/**
 * Queue a command to be executed in the browser.
 * Prefers WebSocket delivery when a client is connected, falls back to HTTP polling.
 * Returns a promise that resolves when the browser sends back the response.
 *
 * For navigation/refresh commands, resolves immediately after delivery since
 * the page unloads before a response can be sent.
 */
export function queueCommand<T>(action: string, payload: unknown): Promise<T> {
  const commandId = generateCommandId();
  const fireAndForget = FIRE_AND_FORGET_COMMANDS.has(action);
  console.log(`[ui-bridge] queueCommand: ${action} (ws=${wsClients.size}, sse=${commandListeners.size}${fireAndForget ? ", fire-and-forget" : ""})`);

  return new Promise((resolve, reject) => {
    // Try WebSocket delivery first
    const sentViaWebSocket = sendCommandViaWebSocket(
      commandId,
      action,
      payload
    );

    let transport = "none";
    let timeoutMs = SSE_COMMAND_TIMEOUT_MS;

    if (sentViaWebSocket) {
      transport = "WebSocket";
      timeoutMs = WEBSOCKET_COMMAND_TIMEOUT_MS;
    }

    // Fail fast if no transport is available at all
    if (!sentViaWebSocket && commandListeners.size === 0) {
      reject(
        new Error(
          `No browser connected — no WebSocket clients and no SSE listeners. ` +
          `Ensure the web app is open in a browser tab.`
        )
      );
      return;
    }

    // For fire-and-forget commands, resolve immediately after delivery.
    // The browser will execute the command but the page unloads before
    // it can send a response, so waiting would always hit the timeout.
    if (fireAndForget) {
      // Still need to deliver via SSE if not sent via WebSocket
      if (!sentViaWebSocket && commandListeners.size > 0) {
        const command: QueuedCommand = {
          commandId,
          action,
          payload,
          timestamp: Date.now(),
        };
        for (const listener of commandListeners) {
          try {
            listener(command);
          } catch {
            // Listener failed, will be cleaned up by self-cleaning mechanism
          }
        }
      }
      resolve({ success: true, fireAndForget: true, action, timestamp: Date.now() } as T);
      return;
    }

    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(
        new Error(
          `Command ${action} timed out after ${timeoutMs}ms (${transport})`
        )
      );
    }, timeoutMs);

    // Evict oldest pending commands if at capacity
    if (pendingCommands.size >= MAX_PENDING_COMMANDS) {
      const oldestKey = pendingCommands.keys().next().value;
      if (oldestKey) {
        const oldest = pendingCommands.get(oldestKey);
        if (oldest) {
          clearTimeout(oldest.timeout);
          oldest.reject(
            new Error("Command evicted: too many pending commands")
          );
        }
        pendingCommands.delete(oldestKey);
      }
    }

    // Store the pending command
    pendingCommands.set(commandId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    // If WebSocket delivery failed, push via SSE listeners
    if (!sentViaWebSocket) {
      const command: QueuedCommand = {
        commandId,
        action,
        payload,
        timestamp: Date.now(),
      };

      if (commandListeners.size > 0) {
        transport = "SSE";
        for (const listener of commandListeners) {
          try {
            listener(command);
          } catch {
            // Listener failed, will be cleaned up by self-cleaning mechanism
          }
        }
      } else {
        // No SSE listeners connected - add to legacy polling queue as last resort
        transport = "HTTP-poll";
        commandQueue.push(command);

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
    }
  });
}

/**
 * Resolve a pending command with a response from the browser
 */
export function resolveCommand(commandId: string, result: unknown): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    console.log(`[ui-bridge] resolveCommand: ${commandId} not found (already timed out or resolved)`);
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
export function rejectCommand(
  commandId: string,
  errorMessage: string
): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  pending.reject(new Error(errorMessage));
  return true;
}

/**
 * Diagnostic: Get internal transport state for debugging
 */
export function getTransportDiagnostics() {
  return {
    pendingCommandCount: pendingCommands.size,
    pendingCommandIds: Array.from(pendingCommands.keys()),
    commandListenerCount: commandListeners.size,
    wsClientCount: wsClients.size,
    wsClientIds: Array.from(wsClients.keys()),
    commandQueueLength: commandQueue.length,
  };
}

// Legacy command queue for browser polling fallback (when no SSE/WebSocket client is connected)
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

  async getRenderLog(
    query?: RenderLogQuery
  ): Promise<APIResponse<RenderLogEntry[]>> {
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

  async getElement(
    id: string
  ): Promise<APIResponse<ControlSnapshot["elements"][0]>> {
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
      const result = await queueCommand<ControlActionResponse>(
        "executeElementAction",
        {
          id,
          request,
        }
      );
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

  async getComponent(
    id: string
  ): Promise<APIResponse<ControlSnapshot["components"][0]>> {
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
      const result = await queueCommand<ComponentActionResponse>(
        "executeComponentAction",
        {
          id,
          request,
        }
      );
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

  async discover(request?: FindRequest): Promise<APIResponse<FindResponse>> {
    // Deprecated - use find
    try {
      const result = await queueCommand<FindResponse>(
        "discover",
        request || {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getControlSnapshot(): Promise<APIResponse<ControlSnapshot>> {
    // Request fresh snapshot from browser
    try {
      const result = await queueCommand<ControlSnapshot>(
        "getControlSnapshot",
        {}
      );
      updateControlSnapshot(result);
      return success(result);
    } catch (e) {
      const msg = (e as Error).message;
      // If no browser is connected, return error instead of empty cached data
      if (msg.includes("No browser connected")) {
        return error(msg, "NO_BROWSER");
      }
      // For timeouts, fall back to cached snapshot
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

  async getWorkflowStatus(
    runId: string
  ): Promise<APIResponse<WorkflowRunResponse>> {
    try {
      const result = await queueCommand<WorkflowRunResponse>(
        "getWorkflowStatus",
        { runId }
      );
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
      const result = await queueCommand<unknown[]>("getActionHistory", {
        limit: _limit,
      });
      return success(result);
    } catch (_e) {
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

  async getConsoleErrors(
    params?: { since?: number; limit?: number }
  ): Promise<APIResponse<{ errors: CapturedError[]; count: number }>> {
    try {
      const result = await queueCommand<{ errors: CapturedError[]; count: number }>(
        "getConsoleErrors",
        params ?? {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // AI-Native Endpoints
  // --------------------------------------------------------------------------

  async aiSearch(
    criteria: SearchCriteria
  ): Promise<APIResponse<SearchResponse>> {
    try {
      const result = await queueCommand<SearchResponse>("aiSearch", criteria);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiExecute(
    request: NLActionRequest
  ): Promise<APIResponse<NLActionResponse>> {
    try {
      const result = await queueCommand<NLActionResponse>("aiExecute", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiAssert(
    request: AssertionRequest
  ): Promise<APIResponse<AssertionResult>> {
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
      const result = await queueCommand<BatchAssertionResult>(
        "aiAssertBatch",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getSemanticSnapshot(): Promise<APIResponse<SemanticSnapshot>> {
    try {
      const result = await queueCommand<SemanticSnapshot>(
        "getSemanticSnapshot",
        {}
      );
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

  async getSemanticDiff(
    since?: number
  ): Promise<APIResponse<SemanticDiff | null>> {
    try {
      const result = await queueCommand<SemanticDiff | null>(
        "getSemanticDiff",
        { since }
      );
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

  async getComponentState(id: string): Promise<
    APIResponse<{
      state: Record<string, unknown>;
      computed: Record<string, unknown>;
      timestamp: number;
    }>
  > {
    try {
      const result = await queueCommand<{
        state: Record<string, unknown>;
        computed: Record<string, unknown>;
        timestamp: number;
      }>("getComponentState", { id });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Semantic Search Endpoint
  // --------------------------------------------------------------------------

  async aiSemanticSearch(
    criteria: SemanticSearchCriteria
  ): Promise<APIResponse<SemanticSearchResponse>> {
    try {
      const result = await queueCommand<SemanticSearchResponse>(
        "aiSemanticSearch",
        criteria
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Page Navigation Endpoints
  // --------------------------------------------------------------------------

  async pageRefresh(): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageRefresh", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async pageNavigate(request: {
    url: string;
  }): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageNavigate", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async pageGoBack(): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageGoBack", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async pageGoForward(): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageGoForward", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Annotation Endpoints
  // --------------------------------------------------------------------------

  async getAnnotations(): Promise<
    APIResponse<Record<string, ElementAnnotation>>
  > {
    try {
      const result = await queueCommand<Record<string, ElementAnnotation>>(
        "getAnnotations",
        {}
      );
      return success(result);
    } catch (_e) {
      return success({});
    }
  },

  async getAnnotation(id: string): Promise<APIResponse<ElementAnnotation>> {
    try {
      const result = await queueCommand<ElementAnnotation>("getAnnotation", {
        id,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "NOT_FOUND");
    }
  },

  async setAnnotation(
    id: string,
    annotation: ElementAnnotation
  ): Promise<APIResponse<ElementAnnotation>> {
    try {
      const result = await queueCommand<ElementAnnotation>("setAnnotation", {
        id,
        annotation,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async deleteAnnotation(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("deleteAnnotation", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async importAnnotations(
    config: AnnotationConfig
  ): Promise<APIResponse<{ count: number }>> {
    try {
      const result = await queueCommand<{ count: number }>(
        "importAnnotations",
        config
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async exportAnnotations(): Promise<APIResponse<AnnotationConfig>> {
    try {
      const result = await queueCommand<AnnotationConfig>(
        "exportAnnotations",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getAnnotationCoverage(): Promise<APIResponse<AnnotationCoverage>> {
    try {
      const result = await queueCommand<AnnotationCoverage>(
        "getAnnotationCoverage",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // State Management Endpoints
  // --------------------------------------------------------------------------

  async getStates(): Promise<APIResponse<UIState[]>> {
    try {
      const result = await queueCommand<UIState[]>("getStates", {});
      return success(result);
    } catch (_e) {
      return success([]);
    }
  },

  async getState(id: string): Promise<APIResponse<UIState>> {
    try {
      const result = await queueCommand<UIState>("getState", { id });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "NOT_FOUND");
    }
  },

  async getActiveStates(): Promise<APIResponse<UIState[]>> {
    try {
      const result = await queueCommand<UIState[]>("getActiveStates", {});
      return success(result);
    } catch (_e) {
      return success([]);
    }
  },

  async activateState(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("activateState", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async deactivateState(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("deactivateState", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getStateGroups(): Promise<APIResponse<UIStateGroup[]>> {
    try {
      const result = await queueCommand<UIStateGroup[]>("getStateGroups", {});
      return success(result);
    } catch (_e) {
      return success([]);
    }
  },

  async activateStateGroup(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("activateStateGroup", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async deactivateStateGroup(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("deactivateStateGroup", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getTransitions(): Promise<APIResponse<UITransition[]>> {
    try {
      const result = await queueCommand<UITransition[]>("getTransitions", {});
      return success(result);
    } catch (_e) {
      return success([]);
    }
  },

  async canExecuteTransition(
    id: string
  ): Promise<APIResponse<{ canExecute: boolean; reason?: string }>> {
    try {
      const result = await queueCommand<{
        canExecute: boolean;
        reason?: string;
      }>("canExecuteTransition", { id });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async executeTransition(id: string): Promise<APIResponse<TransitionResult>> {
    try {
      const result = await queueCommand<TransitionResult>("executeTransition", {
        id,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async findPath(request: {
    targetStates: string[];
  }): Promise<APIResponse<PathResult>> {
    try {
      const result = await queueCommand<PathResult>("findPath", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async navigateTo(request: {
    targetStates: string[];
  }): Promise<APIResponse<NavigationResult>> {
    try {
      const result = await queueCommand<NavigationResult>(
        "navigateTo",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getStateSnapshot(): Promise<APIResponse<StateSnapshot>> {
    try {
      const result = await queueCommand<StateSnapshot>("getStateSnapshot", {});
      return success(result);
    } catch (_e) {
      // Fallback: return minimal snapshot
      return success({
        timestamp: Date.now(),
        activeStates: [],
        states: [],
        groups: [],
        transitions: [],
      });
    }
  },

  // --------------------------------------------------------------------------
  // Intent Endpoints
  // --------------------------------------------------------------------------

  async executeIntent(request: {
    intentId: string;
    params?: Record<string, unknown>;
  }): Promise<APIResponse<IntentExecutionResult>> {
    try {
      const result = await queueCommand<IntentExecutionResult>(
        "executeIntent",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async findIntent(request: {
    query: string;
  }): Promise<APIResponse<IntentSearchResponse>> {
    try {
      const result = await queueCommand<IntentSearchResponse>(
        "findIntent",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async listIntents(): Promise<APIResponse<Intent[]>> {
    try {
      const result = await queueCommand<Intent[]>("listIntents", {});
      return success(result);
    } catch (_e) {
      return success([]);
    }
  },

  async registerIntent(intent: Intent): Promise<APIResponse<Intent>> {
    try {
      const result = await queueCommand<Intent>("registerIntent", intent);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async executeIntentFromQuery(request: {
    query: string;
    params?: Record<string, unknown>;
  }): Promise<APIResponse<IntentExecutionResult>> {
    try {
      const result = await queueCommand<IntentExecutionResult>(
        "executeIntentFromQuery",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Recovery Endpoints
  // --------------------------------------------------------------------------

  async attemptRecovery(
    request: RecoveryAttemptRequest
  ): Promise<APIResponse<RecoveryAttemptResult>> {
    try {
      const result = await queueCommand<RecoveryAttemptResult>(
        "attemptRecovery",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Cross-App Analysis Endpoints
  // --------------------------------------------------------------------------

  async analyzePageData(): Promise<APIResponse<PageDataMap>> {
    try {
      const result = await queueCommand<PageDataMap>("analyzePageData", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async analyzePageRegions(): Promise<APIResponse<PageRegionMap>> {
    try {
      const result = await queueCommand<PageRegionMap>(
        "analyzePageRegions",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async analyzeStructuredData(): Promise<
    APIResponse<StructuredDataExtraction>
  > {
    try {
      const result = await queueCommand<StructuredDataExtraction>(
        "analyzeStructuredData",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async crossAppCompare(request: {
    sourceSnapshot: SemanticSnapshot;
    targetSnapshot: SemanticSnapshot;
    sourceComponents?: ComponentInfo[];
    targetComponents?: ComponentInfo[];
  }): Promise<APIResponse<CrossAppComparisonReport>> {
    try {
      const result = await queueCommand<CrossAppComparisonReport>(
        "crossAppCompare",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },
};
