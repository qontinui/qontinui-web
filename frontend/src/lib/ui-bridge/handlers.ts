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
  CapturedError,
  ElementDesignData,
  InteractionStateName,
  ResponsiveSnapshot,
  StateStyles,
} from "@qontinui/ui-bridge";
import type {
  StyleGuideConfig,
  StyleAuditReport,
} from "@qontinui/ui-bridge/specs";
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

      if (tabListeners.size > 0) {
        transport = "SSE";
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
// Server-Side Snapshot Fallback
// ============================================================================

/**
 * When no browser tab is connected, fetch the page HTML from localhost
 * and extract basic interactive elements. This provides a degraded but
 * non-empty snapshot for automation tools that query the snapshot API
 * without a browser tab open.
 */
/**
 * Fetch a single page's HTML and parse it into elements.
 */
async function fetchPageElements(
  url: string
): Promise<ControlSnapshot["elements"]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const html = await res.text();
    return parseHtmlToSnapshot(html).elements;
  } catch {
    return [];
  }
}

/**
 * Common app page paths to scan for SSR element discovery.
 * These are tried in parallel when no specific URL is provided.
 */
const APP_PAGE_PATHS = ["/chat", "/execute", "/runs", "/runners"];

async function fetchServerSideSnapshot(
  pagePath?: string
): Promise<ControlSnapshot | null> {
  const port = process.env.PORT || 3001;
  const baseUrl = `http://localhost:${port}`;

  if (pagePath) {
    // Specific page requested — fetch only that page (and base as fallback)
    const elements = await fetchPageElements(`${baseUrl}${pagePath}`);
    if (elements.length > 0) {
      return {
        timestamp: Date.now(),
        elements,
        components: [],
        workflows: [],
        activeRuns: [],
      };
    }
    // Fall back to base URL
    const baseElements = await fetchPageElements(baseUrl);
    if (baseElements.length > 0) {
      return {
        timestamp: Date.now(),
        elements: baseElements,
        components: [],
        workflows: [],
        activeRuns: [],
      };
    }
    return null;
  }

  // No specific page — fetch base URL + common app pages in parallel
  // and merge elements for comprehensive coverage.
  const urls = [baseUrl, ...APP_PAGE_PATHS.map((p) => `${baseUrl}${p}`)];
  const results = await Promise.allSettled(urls.map(fetchPageElements));

  const seenIds = new Set<string>();
  const merged: ControlSnapshot["elements"] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const el of result.value) {
        if (!seenIds.has(el.id)) {
          seenIds.add(el.id);
          merged.push(el);
        }
      }
    }
  }

  if (merged.length > 0) {
    return {
      timestamp: Date.now(),
      elements: merged,
      components: [],
      workflows: [],
      activeRuns: [],
    };
  }
  return null;
}

/**
 * Infer element type and category from HTML tag name.
 * Headings and text-like elements are categorized as "content",
 * while containers and interactive elements are "interactive".
 */
function inferTypeAndCategory(tag: string): {
  type: string;
  category: "interactive" | "content";
} {
  const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"];
  const contentTags = [
    "p",
    "li",
    "td",
    "th",
    "label",
    "figcaption",
    "caption",
    "blockquote",
    "pre",
    "code",
    "dd",
    "dt",
    "legend",
    "summary",
  ];
  if (headingTags.includes(tag)) {
    return { type: "heading", category: "content" };
  }
  if (tag === "span") {
    return { type: "text", category: "content" };
  }
  if (contentTags.includes(tag)) {
    return { type: tag, category: "content" };
  }
  if (
    tag === "section" ||
    tag === "article" ||
    tag === "main" ||
    tag === "nav"
  ) {
    return { type: tag, category: "interactive" };
  }
  return { type: "container", category: "interactive" };
}

/**
 * Parse raw HTML into a basic ControlSnapshot by extracting interactive
 * elements (buttons, links, inputs) via regex. This is intentionally
 * simple — no dependency on a full HTML parser.
 */
function parseHtmlToSnapshot(html: string): ControlSnapshot {
  const elements: ControlSnapshot["elements"] = [];
  const nullRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const defaultState = {
    visible: true,
    enabled: true,
    focused: false,
    rect: nullRect,
  };

  // Track seen IDs to avoid duplicates
  const seenIds = new Set<string>();

  // Match <a>, <button>, <input>, <select>, <textarea> tags
  const tagRe =
    /<(a|button|input|select|textarea)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tagRe.exec(html)) !== null && idx < 200) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = match[2] || "";
    const innerText = (match[3] || "")
      .replace(/<[^>]*>/g, "")
      .trim()
      .slice(0, 100);

    // Extract id attribute (prefer data-ui-id over id)
    const uiIdMatch = attrs.match(/\bdata-ui-id\s*=\s*["']([^"']+)["']/i);
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
    const id: string = uiIdMatch?.[1] ?? idMatch?.[1] ?? `ssr-${tag}-${idx}`;

    if (seenIds.has(id)) {
      idx++;
      continue;
    }
    seenIds.add(id);

    // Extract aria-label or title
    const labelMatch = attrs.match(
      /\b(?:aria-label|title)\s*=\s*["']([^"']+)["']/i
    );
    const label =
      labelMatch?.[1] ||
      innerText ||
      (uiIdMatch ? uiIdMatch[1] : idMatch ? idMatch[1] : tag);

    // Determine type and actions
    let type = tag;
    const actions: string[] = [];
    if (tag === "a") {
      type = "link";
      actions.push("click");
    } else if (tag === "button") {
      type = "button";
      actions.push("click");
    } else if (tag === "input") {
      const inputType = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
      type = `input-${inputType?.[1] || "text"}`;
      if (inputType?.[1] === "submit" || inputType?.[1] === "button") {
        actions.push("click");
      } else {
        actions.push("type", "clear");
      }
    } else if (tag === "select") {
      type = "select";
      actions.push("select");
    } else if (tag === "textarea") {
      type = "textarea";
      actions.push("type", "clear");
    }

    elements.push({
      id,
      type,
      label,
      actions,
      state: defaultState,
      category: "interactive" as const,
    });
    idx++;
  }

  // Also match any element with data-ui-id or id attribute (covers div, span,
  // section, header, etc.) that wasn't already captured above.
  const uiIdRe =
    /<(\w+)\b([^>]*?\bdata-ui-id\s*=\s*["']([^"']+)["'][^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let uiMatch: RegExpExecArray | null;

  while ((uiMatch = uiIdRe.exec(html)) !== null && idx < 300) {
    const tag = (uiMatch[1] ?? "").toLowerCase();
    const attrs = uiMatch[2] || "";
    const uiId = uiMatch[3] || "";
    const innerText = (uiMatch[4] || "")
      .replace(/<[^>]*>/g, "")
      .trim()
      .slice(0, 100);

    if (!uiId || seenIds.has(uiId)) continue;
    seenIds.add(uiId);

    const labelMatch = attrs.match(
      /\b(?:aria-label|title)\s*=\s*["']([^"']+)["']/i
    );
    const label = labelMatch?.[1] || innerText || uiId;

    // Infer type and category from tag
    const { type: uiType, category: uiCategory } = inferTypeAndCategory(tag);

    elements.push({
      id: uiId,
      type: uiType,
      label,
      actions: [],
      state: { ...defaultState, textContent: innerText || undefined },
      category: uiCategory,
    });
    idx++;
  }

  // Third pass: catch data-ui-id elements that were consumed inside the content
  // of a parent match above (regex non-overlapping matches skip nested elements).
  // This uses an opening-tag-only regex that doesn't capture content.
  const openTagRe =
    /<(\w+)\b([^>]*?)\bdata-ui-id\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openTagRe.exec(html)) !== null && idx < 400) {
    const tag = (openMatch[1] ?? "").toLowerCase();
    const attrsBefore = openMatch[2] || "";
    const uiId = openMatch[3] || "";
    const attrsAfter = openMatch[4] || "";
    const allAttrs = attrsBefore + 'data-ui-id="' + uiId + '"' + attrsAfter;

    if (!uiId || seenIds.has(uiId)) continue;
    seenIds.add(uiId);

    // Try to extract text content after the opening tag
    const afterTag = html.slice((openMatch.index ?? 0) + openMatch[0].length);
    const closeIdx = afterTag.indexOf(`</${tag}>`);
    const innerText =
      closeIdx >= 0
        ? afterTag
            .slice(0, closeIdx)
            .replace(/<[^>]*>/g, "")
            .trim()
            .slice(0, 100)
        : "";

    const labelMatch = allAttrs.match(
      /\b(?:aria-label|title)\s*=\s*["']([^"']+)["']/i
    );
    const label = labelMatch?.[1] || innerText || uiId;

    const { type: uiType, category: uiCategory } = inferTypeAndCategory(tag);

    elements.push({
      id: uiId,
      type: uiType,
      label,
      actions: [],
      state: { ...defaultState, textContent: innerText || undefined },
      category: uiCategory,
    });
    idx++;
  }

  return {
    timestamp: Date.now(),
    elements,
    components: [],
    workflows: [],
    activeRuns: [],
  };
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

      // The browser AutoRegister may use auto-generated semantic IDs instead
      // of developer-assigned data-ui-id values due to timing edge cases.
      // Supplement the browser snapshot with SSR-parsed data-ui-id elements
      // so that automation tools can reliably find elements by their data-ui-id.
      try {
        const ssrSnapshot = await fetchServerSideSnapshot(request?.url);
        if (ssrSnapshot && ssrSnapshot.elements.length > 0) {
          const browserIds = new Set(result.elements.map((e) => e.id));
          for (const ssrEl of ssrSnapshot.elements) {
            if (!browserIds.has(ssrEl.id)) {
              // Find a matching browser element by label or type to copy state
              const matchByLabel = result.elements.find(
                (e) =>
                  e.label &&
                  ssrEl.label &&
                  e.label.trim().toLowerCase() ===
                    ssrEl.label.trim().toLowerCase() &&
                  e.type === ssrEl.type
              );
              result.elements.push({
                ...ssrEl,
                state: matchByLabel?.state ?? ssrEl.state,
              });
            }
          }
        }
      } catch {
        // SSR supplement failed — return browser snapshot as-is
      }

      updateControlSnapshot(result);
      return success(result);
    } catch {
      // Fall back to cached snapshot when browser is unavailable (disconnected
      // or timed out). Returning cached data is more useful for automation
      // workflows than an error — the caller can check the timestamp to gauge
      // freshness.

      // When a specific URL is requested, always try SSR fallback for that page
      // (the cache may contain elements from a different page).
      if (request?.url) {
        try {
          const ssrSnapshot = await fetchServerSideSnapshot(request.url);
          if (ssrSnapshot && ssrSnapshot.elements.length > 0) {
            console.log(
              `[ui-bridge] Server-side fallback snapshot for ${request.url}: ${ssrSnapshot.elements.length} elements`
            );
            updateControlSnapshot(ssrSnapshot);
            return success(ssrSnapshot);
          }
        } catch {
          // SSR fallback for specific URL failed
        }
      }

      // If cached snapshot has elements, return it
      if (latestControlSnapshot.elements.length > 0) {
        return success(latestControlSnapshot);
      }

      // No browser connected and cache is empty — try server-side HTML
      // fallback to provide at least basic page elements for automation
      // tools that query the snapshot without a browser tab open.
      try {
        const ssrSnapshot = await fetchServerSideSnapshot();
        if (ssrSnapshot && ssrSnapshot.elements.length > 0) {
          console.log(
            `[ui-bridge] Server-side fallback snapshot: ${ssrSnapshot.elements.length} elements`
          );
          updateControlSnapshot(ssrSnapshot);
          return success(ssrSnapshot);
        }
      } catch {
        // SSR fallback failed — return whatever cache has
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
  }): Promise<APIResponse<{ events: unknown[]; count: number }>> {
    try {
      const result = await queueCommand<{ events: unknown[]; count: number }>(
        "getBrowserEvents",
        params ?? {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Design Review Endpoints
  // --------------------------------------------------------------------------

  async getElementStyles(id: string): Promise<APIResponse<ElementDesignData>> {
    try {
      const result = await queueCommand<ElementDesignData>("getElementStyles", {
        elementId: id,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getElementStateStyles(
    id: string,
    request: { states?: InteractionStateName[] }
  ): Promise<APIResponse<{ elementId: string; stateStyles: StateStyles[] }>> {
    try {
      const result = await queueCommand<{
        elementId: string;
        stateStyles: StateStyles[];
      }>("getElementStateStyles", {
        elementId: id,
        ...request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getDesignSnapshot(request?: {
    elementIds?: string[];
    includePseudoElements?: boolean;
  }): Promise<
    APIResponse<{ elements: ElementDesignData[]; timestamp: number }>
  > {
    try {
      const result = await queueCommand<{
        elements: ElementDesignData[];
        timestamp: number;
      }>("getDesignSnapshot", request ?? {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getResponsiveSnapshots(request: {
    viewports?: Record<string, number>;
    elementIds?: string[];
  }): Promise<APIResponse<ResponsiveSnapshot[]>> {
    try {
      const result = await queueCommand<ResponsiveSnapshot[]>(
        "getResponsiveSnapshots",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async runDesignAudit(request?: {
    guide?: StyleGuideConfig;
    elementIds?: string[];
  }): Promise<APIResponse<StyleAuditReport>> {
    try {
      const result = await queueCommand<StyleAuditReport>(
        "runDesignAudit",
        request ?? {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async loadStyleGuide(request: {
    guide: StyleGuideConfig;
  }): Promise<APIResponse<{ loaded: boolean }>> {
    try {
      const result = await queueCommand<{ loaded: boolean }>(
        "loadStyleGuide",
        request
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getStyleGuide(): Promise<APIResponse<StyleGuideConfig | null>> {
    try {
      const result = await queueCommand<StyleGuideConfig | null>(
        "getStyleGuide",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async clearStyleGuide(): Promise<APIResponse<{ cleared: boolean }>> {
    try {
      const result = await queueCommand<{ cleared: boolean }>(
        "clearStyleGuide",
        {}
      );
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },
};
