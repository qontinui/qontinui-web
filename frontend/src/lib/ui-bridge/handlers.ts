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
  RenderLogQuery,
  APIResponse,
  BrowserEventsResponse,
} from "@qontinui/ui-bridge/server";
import type { CapturedError } from "@qontinui/ui-bridge";
import type {
  CompositeIdleStatus,
  SignalStatus,
} from "@qontinui/ui-bridge/idle";
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

// Latest semantic snapshot from browser
let latestSemanticSnapshot: SemanticSnapshot | null = null;

// ============================================================================
// Shared State via globalThis
// ============================================================================
// Next.js dev mode compiles each API route into a separate module graph.
// Module-level variables are duplicated across routes, breaking the command
// relay (SSE stream subscribes to one Map, snapshot handler checks a different
// Map). Using globalThis for tabListeners and pendingCommands ensures all
// routes share the same instances.

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

type CommandListener = (command: QueuedCommand) => void;

interface TabListener {
  tabId: string;
  callback: CommandListener;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  /** How many tabs were notified of this command */
  tabsNotified: number;
  /** How many tabs have responded with errors */
  errorResponseCount: number;
  /** First error received (used when all tabs error) */
  firstError?: Error;
  /** Grace timeout for multi-tab error deferral (fallback if some tabs go silent) */
  graceTimeout?: NodeJS.Timeout;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__uiBridgePendingCommands) {
  g.__uiBridgePendingCommands = new Map<string, PendingCommand>();
}
if (!g.__uiBridgeTabListeners) {
  g.__uiBridgeTabListeners = new Map<string, TabListener>();
}
// Cached control snapshot survives HMR module reloads so the fallback in
// getControlSnapshot() returns the last-known elements while the browser
// tab reconnects after a hot reload.
if (!g.__uiBridgeLatestControlSnapshot) {
  g.__uiBridgeLatestControlSnapshot = {
    timestamp: Date.now(),
    elements: [],
    components: [],
    workflows: [],
    activeRuns: [],
  } as ControlSnapshot;
}

const pendingCommands: Map<string, PendingCommand> =
  g.__uiBridgePendingCommands;
const tabListeners: Map<string, TabListener> = g.__uiBridgeTabListeners;
let latestControlSnapshot: ControlSnapshot = g.__uiBridgeLatestControlSnapshot;

const MAX_PENDING_COMMANDS = 200;

// Command timeout in milliseconds (10 seconds for WebSocket, 30 seconds for SSE/HTTP)
const WEBSOCKET_COMMAND_TIMEOUT_MS = 10000;
const SSE_COMMAND_TIMEOUT_MS = 15000;

// When multiple tabs are notified and one responds with an error, wait up to
// this long for a success from another tab. Acts as a fallback when some tabs
// go silent (broken SSE, background throttling). If all notified tabs respond
// with errors before this, rejection is immediate.
const MULTI_TAB_GRACE_MS = 3000;

/**
 * Subscribe to new commands. Returns an unsubscribe function.
 * Used by the SSE stream endpoint to push commands to the browser.
 * Each tab registers with a unique tabId for targeted command dispatch.
 */
export function subscribeToCommands(
  listener: CommandListener,
  tabId?: string
): () => void {
  const id =
    tabId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  tabListeners.set(id, { tabId: id, callback: listener });
  console.log(
    `[ui-bridge] SSE listener connected: ${id} (total: ${tabListeners.size})`
  );

  // Proactively capture a snapshot when a browser tab connects.
  // This populates the cache so that even after the tab disconnects,
  // the cached snapshot still has elements for external callers.
  // Delay 500ms to allow auto-registration to discover DOM elements,
  // with a retry at 2s if the first attempt returns zero elements.
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const captureSnapshot = async () => {
    if (!tabListeners.has(id)) return false;
    try {
      const result = await queueCommand<ControlSnapshot>(
        "getControlSnapshot",
        {},
        { targetTabId: id }
      );
      if (result.elements && result.elements.length > 0) {
        updateControlSnapshot(result);
        console.log(
          `[ui-bridge] Proactive snapshot captured: ${result.elements.length} elements`
        );
        return true;
      }
    } catch {
      // Tab may have disconnected; ignore
    }
    return false;
  };

  const proactiveTimer = setTimeout(async () => {
    const captured = await captureSnapshot();
    if (!captured && tabListeners.has(id)) {
      // Retry after a longer delay in case auto-registration is slow
      retryTimer = setTimeout(() => captureSnapshot(), 1500);
    }
  }, 500);

  return () => {
    clearTimeout(proactiveTimer);
    if (retryTimer) clearTimeout(retryTimer);
    tabListeners.delete(id);
    console.log(
      `[ui-bridge] SSE listener disconnected: ${id} (total: ${tabListeners.size})`
    );
  };
}

/**
 * Check if any SSE listeners are connected
 */
export function hasCommandListeners(): boolean {
  return tabListeners.size > 0;
}

/**
 * Get list of connected tab IDs
 */
export function getConnectedTabs(): string[] {
  return Array.from(tabListeners.keys());
}

export interface TabInfo {
  tabId: string;
  url?: string;
  pathname?: string;
  title?: string;
}

/**
 * Get connected tabs with page info (URL, title) by querying each tab.
 * Falls back to ID-only entries if a tab doesn't respond in time.
 */
export async function getTabsWithInfo(): Promise<TabInfo[]> {
  const tabIds = getConnectedTabs();

  const results = await Promise.all(
    tabIds.map(async (tabId): Promise<TabInfo> => {
      try {
        const info = await Promise.race([
          queueCommand<{ url?: string; pathname?: string; title?: string }>(
            "getTabInfo",
            {},
            { targetTabId: tabId }
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        return {
          tabId,
          url: info?.url,
          pathname: info?.pathname,
          title: info?.title,
        };
      } catch {
        return { tabId };
      }
    })
  );

  return results;
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

  // Proactively capture a snapshot when a WebSocket client connects.
  // Same pattern as SSE listener — populates the cache for later use.
  setTimeout(async () => {
    if (!wsClients.has(client.clientId)) return;
    try {
      const result = await queueCommand<ControlSnapshot>(
        "getControlSnapshot",
        {},
        { targetTabId: client.clientId }
      );
      if (result.elements && result.elements.length > 0) {
        updateControlSnapshot(result);
        console.log(
          `[ui-bridge] Proactive WS snapshot captured: ${result.elements.length} elements`
        );
      }
    } catch {
      // Client may have disconnected; ignore
    }
  }, 500);
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
 * Get a connected WebSocket client.
 * If targetTabId is provided, returns that specific client (since clientId IS tabId).
 * Otherwise returns the first connected client (backward compatible).
 */
function getConnectedClient(targetTabId?: string): WebSocketClientEntry | null {
  if (targetTabId) {
    const entry = wsClients.get(targetTabId);
    if (entry) {
      if (entry.client.isConnected()) {
        return entry;
      } else {
        wsClients.delete(targetTabId);
      }
    }
    return null;
  }

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
 * Send a command via WebSocket to a connected client.
 * If targetTabId is provided, sends only to that specific tab's WebSocket.
 * Otherwise sends to the first connected client (backward compatible).
 * Returns true if command was sent, false if no client available.
 */
function sendCommandViaWebSocket(
  commandId: string,
  action: string,
  payload: unknown,
  targetTabId?: string
): boolean {
  const clientEntry = getConnectedClient(targetTabId);
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
const FIRE_AND_FORGET_COMMANDS = new Set(["pageNavigate", "pageRefresh"]);

/**
 * Queue a command to be executed in the browser.
 * Prefers WebSocket delivery when a client is connected, falls back to HTTP polling.
 * Returns a promise that resolves when the browser sends back the response.
 *
 * For navigation/refresh commands, resolves immediately after delivery since
 * the page unloads before a response can be sent.
 *
 * If options.targetTabId is provided, the command is sent only to that tab.
 * Otherwise, the command is broadcast to all connected tabs (backward compatible).
 */
export function queueCommand<T>(
  action: string,
  payload: unknown,
  options?: { targetTabId?: string }
): Promise<T> {
  const targetTabId = options?.targetTabId;
  const commandId = generateCommandId();
  const fireAndForget = FIRE_AND_FORGET_COMMANDS.has(action);
  console.log(
    `[ui-bridge] queueCommand: ${action} (ws=${wsClients.size}, sse=${tabListeners.size}${targetTabId ? `, target=${targetTabId}` : ""}${fireAndForget ? ", fire-and-forget" : ""})`
  );

  return new Promise((resolve, reject) => {
    // Try WebSocket delivery first
    const sentViaWebSocket = sendCommandViaWebSocket(
      commandId,
      action,
      payload,
      targetTabId
    );

    let transport = "none";
    let timeoutMs = SSE_COMMAND_TIMEOUT_MS;

    if (sentViaWebSocket) {
      transport = "WebSocket";
      timeoutMs = WEBSOCKET_COMMAND_TIMEOUT_MS;
    }

    // Fail fast if no transport is available at all
    if (!sentViaWebSocket && tabListeners.size === 0) {
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
      if (!sentViaWebSocket && tabListeners.size > 0) {
        const command: QueuedCommand = {
          commandId,
          action,
          payload,
          timestamp: Date.now(),
        };
        if (targetTabId) {
          const listener = tabListeners.get(targetTabId);
          if (listener) {
            try {
              listener.callback(command);
            } catch {
              /* self-cleaning */
            }
          }
        } else {
          for (const listener of tabListeners.values()) {
            try {
              listener.callback(command);
            } catch {
              /* self-cleaning */
            }
          }
        }
      }
      resolve({
        success: true,
        fireAndForget: true,
        action,
        timestamp: Date.now(),
      } as T);
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

    // Store the pending command (tabsNotified updated after broadcast)
    const pending: PendingCommand = {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
      tabsNotified: sentViaWebSocket ? 1 : 0,
      errorResponseCount: 0,
    };
    pendingCommands.set(commandId, pending);

    // If WebSocket delivery failed, push via SSE listeners
    if (!sentViaWebSocket) {
      const command: QueuedCommand = {
        commandId,
        action,
        payload,
        timestamp: Date.now(),
      };

      if (tabListeners.size > 0) {
        transport = "SSE";
        if (targetTabId) {
          const listener = tabListeners.get(targetTabId);
          if (listener) {
            try {
              listener.callback(command);
              pending.tabsNotified = 1;
            } catch {
              /* self-cleaning */
            }
          }
        } else {
          let notified = 0;
          for (const listener of tabListeners.values()) {
            try {
              listener.callback(command);
              notified++;
            } catch {
              /* self-cleaning */
            }
          }
          pending.tabsNotified = notified;
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
    console.log(
      `[ui-bridge] resolveCommand: ${commandId} not found (already timed out or resolved)`
    );
    return false;
  }

  clearTimeout(pending.timeout);
  if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
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

  pending.errorResponseCount++;
  if (!pending.firstError) {
    pending.firstError = new Error(errorMessage);
  }

  // All notified tabs have responded with errors — reject immediately
  if (pending.errorResponseCount >= pending.tabsNotified) {
    clearTimeout(pending.timeout);
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    pendingCommands.delete(commandId);
    pending.reject(pending.firstError!);
    return true;
  }

  // Multiple tabs notified but not all have responded yet. Start a grace
  // timer (if not already running) as a fallback for tabs that go silent.
  // A success from any tab will resolve via resolveCommand and cancel this.
  if (!pending.graceTimeout) {
    pending.graceTimeout = setTimeout(() => {
      const stillPending = pendingCommands.get(commandId);
      if (stillPending) {
        console.log(
          `[ui-bridge] rejectCommand: ${commandId} grace timeout — ${stillPending.errorResponseCount}/${stillPending.tabsNotified} tabs responded`
        );
        clearTimeout(stillPending.timeout);
        pendingCommands.delete(commandId);
        stillPending.reject(stillPending.firstError || new Error(errorMessage));
      }
    }, MULTI_TAB_GRACE_MS);
  }

  console.log(
    `[ui-bridge] rejectCommand: ${commandId} error ${pending.errorResponseCount}/${pending.tabsNotified}, waiting for other tabs`
  );
  return true;
}

/**
 * Diagnostic: Get internal transport state for debugging
 */
export function getTransportDiagnostics() {
  return {
    pendingCommandCount: pendingCommands.size,
    pendingCommandIds: Array.from(pendingCommands.keys()),
    commandListenerCount: tabListeners.size,
    connectedTabs: Array.from(tabListeners.keys()),
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
  // Persist to globalThis so the cache survives HMR module reloads
  g.__uiBridgeLatestControlSnapshot = snapshot;
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

// The SDK interface grows faster than the web server implementation.
// Unimplemented handlers return 501 at runtime (see nextjs.ts line 122).
export const uiBridgeHandlers = {
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
    // If the cache is empty, try to refresh from the browser
    if (latestControlSnapshot.elements.length === 0) {
      try {
        const result = await queueCommand<ControlSnapshot>(
          "getControlSnapshot",
          {}
        );
        updateControlSnapshot(result);
      } catch {
        // Browser unavailable — return the (empty) cached data
      }
    }
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

  async find(
    request?: FindRequest & { targetTabId?: string }
  ): Promise<APIResponse<FindResponse>> {
    try {
      const { targetTabId, ...payload } = request || {};
      const result = await queueCommand<FindResponse>("find", payload, {
        targetTabId,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async discover(
    request?: FindRequest & { targetTabId?: string }
  ): Promise<APIResponse<FindResponse>> {
    // Deprecated - use find
    try {
      const { targetTabId, ...payload } = request || {};
      const result = await queueCommand<FindResponse>("discover", payload, {
        targetTabId,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getControlSnapshot(request?: {
    targetTabId?: string;
    url?: string;
  }): Promise<APIResponse<ControlSnapshot>> {
    // Request fresh snapshot from browser
    try {
      const result = await queueCommand<ControlSnapshot>(
        "getControlSnapshot",
        {},
        { targetTabId: request?.targetTabId }
      );

      updateControlSnapshot(result);
      return success(result);
    } catch {
      // Fall back to cached snapshot when browser is unavailable (disconnected
      // or timed out). Returning cached data is more useful for automation
      // workflows than an error — the caller can check the timestamp to gauge
      // freshness.
      if (latestControlSnapshot.elements.length > 0) {
        return success(latestControlSnapshot);
      }

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

  async getConsoleErrors(params?: {
    since?: number;
    limit?: number;
  }): Promise<APIResponse<{ errors: CapturedError[]; count: number }>> {
    try {
      const result = await queueCommand<{
        errors: CapturedError[];
        count: number;
      }>("getConsoleErrors", params ?? {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async clearConsoleErrors(): Promise<APIResponse<{ cleared: boolean }>> {
    try {
      const result = await queueCommand<{ cleared: boolean }>(
        "clearConsoleErrors",
        {}
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

  async pageRefresh(request?: {
    targetTabId?: string;
  }): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageRefresh", {}, { targetTabId: request?.targetTabId });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async pageNavigate(request: {
    url: string;
    targetTabId?: string;
  }): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const { targetTabId, ...payload } = request;
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageNavigate", payload, { targetTabId });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async pageGoBack(request?: {
    targetTabId?: string;
  }): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageGoBack", {}, { targetTabId: request?.targetTabId });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async pageGoForward(request?: {
    targetTabId?: string;
  }): Promise<
    APIResponse<{ success: boolean; url?: string; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        success: boolean;
        url?: string;
        timestamp: number;
      }>("pageGoForward", {}, { targetTabId: request?.targetTabId });
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

  // --------------------------------------------------------------------------
  // Performance Diagnostics Endpoints
  // --------------------------------------------------------------------------

  async getPerformanceEntries(): Promise<APIResponse<unknown>> {
    try {
      const result = await queueCommand<unknown>("getPerformanceEntries", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async clearPerformanceEntries(): Promise<APIResponse<{ cleared: boolean }>> {
    try {
      const result = await queueCommand<{ cleared: boolean }>(
        "clearPerformanceEntries",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getBrowserEvents(params?: {
    type?: string;
    since?: number;
    limit?: number;
    severity?: string;
    deduplicate?: boolean;
  }): Promise<APIResponse<BrowserEventsResponse>> {
    try {
      const result = await queueCommand<BrowserEventsResponse>(
        "getBrowserEvents",
        params ?? {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Idle Detection
  // --------------------------------------------------------------------------

  async getIdleStatus(): Promise<APIResponse<CompositeIdleStatus>> {
    try {
      const result = await queueCommand<CompositeIdleStatus>(
        "getIdleStatus",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getIdleSignalStatus(
    signal: string
  ): Promise<APIResponse<SignalStatus>> {
    try {
      const result = await queueCommand<SignalStatus>("getIdleSignalStatus", {
        signal,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async waitForIdle(request?: {
    timeout?: number;
    minStableMs?: number;
    exclude?: string[];
  }): Promise<APIResponse<CompositeIdleStatus>> {
    try {
      const result = await queueCommand<CompositeIdleStatus>(
        "waitForIdle",
        request ?? {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async waitForSignalIdle(
    signal: string,
    request?: { timeout?: number; minStableMs?: number }
  ): Promise<APIResponse<SignalStatus>> {
    try {
      const result = await queueCommand<SignalStatus>("waitForSignalIdle", {
        signal,
        ...request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async waitForTargets(request: {
    targets: Array<string | { indicator: string }>;
    timeout?: number;
    minStableMs?: number;
  }): Promise<APIResponse<Record<string, SignalStatus>>> {
    try {
      const result = await queueCommand<Record<string, SignalStatus>>(
        "waitForTargets",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },
};
