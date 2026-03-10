"use client";

/**
 * UI Bridge Transport Hook
 *
 * Combined transport hook that provides WebSocket as primary communication
 * channel with HTTP polling as fallback.
 *
 * Features:
 * - WebSocket primary, HTTP fallback
 * - Auto-reconnection with exponential backoff (1s initial, 1.5x multiplier, 30s max)
 * - Connection state tracking
 * - Seamless failover between transport methods
 * - Visibility-aware: pauses HTTP polling when tab is hidden to prevent freezes
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useUIBridge } from "@qontinui/ui-bridge/react";
import { CompositeIdleDetector } from "@qontinui/ui-bridge";

// Transport configuration
export type TransportMode = "websocket" | "http" | "auto";
export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

// Reconnection configuration
const INITIAL_RECONNECT_DELAY_MS = 1000;
const RECONNECT_MULTIPLIER = 1.5;
const MAX_RECONNECT_DELAY_MS = 30000;
const JITTER_FACTOR = 0.1; // +/- 10%

// SSE reconnection delay (fallback transport)
// 10s to avoid triggering Next.js route recompilation cascades in dev mode
const SSE_RECONNECT_DELAY_MS = 10000;

// API endpoints
const COMMANDS_ENDPOINT = "/api/ui-bridge/commands";
const COMMANDS_STREAM_ENDPOINT = "/api/ui-bridge/commands/stream";
const WEBSOCKET_ENDPOINT = "/api/ui-bridge/ws";

/**
 * Set value on a React controlled input, properly triggering onChange.
 * React tracks input values internally via _valueTracker. We must:
 * 1. Use the native HTMLInputElement.prototype.value setter (bypasses React's override)
 * 2. Invalidate React's internal value tracker so it detects the change
 * 3. Dispatch an 'input' event with bubbles so React's delegated handler fires
 */
function setReactInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }
  // Invalidate React's internal value tracker so it sees the change
  const tracker = (element as unknown as Record<string, unknown>)
    ._valueTracker as { setValue?: (v: string) => void } | undefined;
  if (tracker) {
    tracker.setValue?.(value === "" ? " " : "");
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

// WebSocket message types
interface WSCommand {
  type: "command";
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

interface WSCommandResponse {
  type: "command_response";
  commandId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  timestamp: number;
}

interface WSCommandReady {
  type: "command_ready";
  clientId: string;
  timestamp: number;
}

interface WSCommandAck {
  type: "command_ack";
  commandId: string;
  timestamp: number;
}

export interface UIBridgeTransportOptions {
  /**
   * Transport mode: 'websocket', 'http', or 'auto' (default)
   * - 'websocket': Use WebSocket only, fail if unavailable
   * - 'http': Use HTTP polling only
   * - 'auto': Try WebSocket first, fall back to HTTP
   */
  mode?: TransportMode;

  /**
   * WebSocket URL (defaults to window location with /api/ui-bridge/ws path)
   */
  wsUrl?: string;

  /**
   * Enable verbose logging
   */
  verbose?: boolean;
}

export interface UIBridgeTransportResult {
  /**
   * Current connection state
   */
  connectionState: ConnectionState;

  /**
   * Current transport mode being used
   */
  activeTransport: "websocket" | "http" | "sse" | "none";

  /**
   * Whether the transport is ready to receive commands
   */
  isReady: boolean;

  /**
   * Reconnection attempt count
   */
  reconnectAttempts: number;

  /**
   * Manually trigger a reconnection
   */
  reconnect: () => void;

  /**
   * Disconnect the transport
   */
  disconnect: () => void;
}

/**
 * Get or create a stable tab ID using sessionStorage.
 * sessionStorage is per-tab: survives same-origin navigation and refreshes,
 * but a new tab/window gets a new ID.
 */
function getOrCreateTabId(): string {
  const key = "__uiBridge_tabId";
  if (typeof sessionStorage !== "undefined") {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem(key, id);
    return id;
  }
  // Fallback for SSR or environments without sessionStorage
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Calculate reconnection delay with jitter
 */
function calculateReconnectDelay(attempt: number): number {
  const baseDelay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_MULTIPLIER, attempt - 1),
    MAX_RECONNECT_DELAY_MS
  );

  // Add jitter (+/- 10%)
  const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.round(baseDelay + jitter);
}

/**
 * Hook that provides UI Bridge transport with WebSocket primary, HTTP fallback
 */
export function useUIBridgeTransport(
  enabled: boolean = true,
  options: UIBridgeTransportOptions = {}
): UIBridgeTransportResult {
  const { mode = "auto", wsUrl, verbose = false } = options;
  const {
    elements,
    getElement,
    createSnapshot,
    find: findElements,
  } = useUIBridge();

  // State
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [activeTransport, setActiveTransport] = useState<
    "websocket" | "http" | "sse" | "none"
  >("none");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(getOrCreateTabId());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const isIntentionallyClosed = useRef(false);
  const isTabVisibleRef = useRef(true);
  const idleDetectorRef = useRef<CompositeIdleDetector | null>(null);

  // Lazy-init idle detector on first access (avoids useEffect timing issues)
  function getIdleDetector(): CompositeIdleDetector {
    if (!idleDetectorRef.current) {
      idleDetectorRef.current = CompositeIdleDetector.create();
    }
    return idleDetectorRef.current;
  }

  // Clean up idle detector on unmount
  useEffect(() => {
    return () => {
      if (idleDetectorRef.current) {
        idleDetectorRef.current.destroy();
        idleDetectorRef.current = null;
      }
    };
  }, []);

  /**
   * Log helper (only logs if verbose is enabled)
   */
  const log = useCallback(
    (message: string, ...args: unknown[]) => {
      if (verbose) {
        console.log(`[UIBridgeTransport] ${message}`, ...args);
      }
    },
    [verbose]
  );

  /**
   * Read all specs from the global SpecStore
   */
  function handleGetSpecs(): {
    specs: Array<{ specId: string; config: unknown }>;
  } {
    try {
      const w = window as unknown as Record<string, unknown>;
      const store = w.__QONTINUI_SPEC_STORE__ as
        | { getAll?: () => Map<string, unknown> }
        | undefined;
      if (store?.getAll) {
        const allSpecs = store.getAll();
        const specs = Array.from(allSpecs.entries()).map(
          ([specId, config]) => ({
            specId,
            config,
          })
        );
        return { specs };
      }
      const uiBridge = w.__UI_BRIDGE__ as
        | {
            specs?: {
              getGlobalSpecStore?: () => { getAll: () => Map<string, unknown> };
            };
          }
        | undefined;
      if (uiBridge?.specs?.getGlobalSpecStore) {
        const specStore = uiBridge.specs.getGlobalSpecStore();
        const allSpecs = specStore.getAll();
        const specs = Array.from(allSpecs.entries()).map(
          ([specId, config]) => ({
            specId,
            config,
          })
        );
        return { specs };
      }
      return { specs: [] };
    } catch {
      return { specs: [] };
    }
  }

  /**
   * Execute a command and return the result
   * (Same logic as useWebSocketCommandHandler)
   */
  const executeCommand = useCallback(
    async (
      action: string,
      payload: Record<string, unknown>
    ): Promise<unknown> => {
      switch (action) {
        // ========== Control Snapshot ==========
        case "getControlSnapshot": {
          // Use createSnapshot() which calls registry.getAllElements() fresh,
          // rather than the stale `elements` from useMemo.
          return createSnapshot();
        }

        // ========== Element Actions ==========
        case "getElementState": {
          const { id } = payload;
          const element = getElement(id as string);
          if (!element) {
            throw new Error(`Element ${id} not found`);
          }
          const state = element.getState();
          return {
            id: element.id,
            isVisible: state.visible,
            isEnabled: state.enabled,
            text: state.textContent,
            value: state.value,
            checked: state.checked,
            rect: state.rect,
          };
        }

        case "executeElementAction": {
          const { id, request } = payload as {
            id: string;
            request: {
              action: string;
              value?: string;
              params?: Record<string, unknown>;
              text?: string;
              clear?: boolean;
            };
          };
          const element = getElement(id);
          if (!element) {
            throw new Error(`Element ${id} not found`);
          }

          // Get the DOM element from the bridge registry
          const domElement = (element.element ?? null) as HTMLElement | null;
          if (!domElement) {
            throw new Error(`DOM element for ${id} not found`);
          }

          const actionType = request.action;
          switch (actionType) {
            case "click":
              domElement.click();
              break;
            case "focus":
              domElement.focus();
              break;
            case "blur":
              domElement.blur();
              break;
            case "type":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                const text = request.params?.text || request.text || "";
                if (request.params?.clear || request.clear) {
                  setReactInputValue(domElement, "");
                }
                domElement.focus();
                setReactInputValue(domElement, domElement.value + text);
              }
              break;
            case "clear":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                setReactInputValue(domElement, "");
              }
              break;
            case "setValue":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                setReactInputValue(
                  domElement,
                  request.value || (request.params?.value as string) || ""
                );
              }
              break;
            case "select":
              if (domElement instanceof HTMLSelectElement) {
                domElement.value = request.value || "";
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "check":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = true;
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "uncheck":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = false;
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            default:
              throw new Error(`Unknown action: ${actionType}`);
          }

          return {
            success: true,
            action: actionType,
            elementId: id,
          };
        }

        case "highlightElement": {
          const { id } = payload;
          const domElement = (getElement(id as string)?.element ??
            null) as HTMLElement | null;
          if (domElement) {
            const originalOutline = domElement.style.outline;
            const originalTransition = domElement.style.transition;
            domElement.style.transition = "outline 0.2s";
            domElement.style.outline = "3px solid #ff6b00";
            setTimeout(() => {
              domElement.style.outline = originalOutline;
              domElement.style.transition = originalTransition;
            }, 2000);
          }
          return { success: true };
        }

        // ========== Find / Discovery ==========
        case "find":
        case "discover": {
          // Check if this is a getSpecs request routed through find/discover
          const findPayload = payload as Record<string, unknown> | undefined;
          if (findPayload?.action === "getSpecs") {
            return handleGetSpecs();
          }

          // Use createSnapshot() for fresh DOM scan (same as getControlSnapshot)
          const snapshot = createSnapshot();
          return {
            elements: snapshot.elements,
            total: snapshot.elements.length,
            durationMs: 0,
            timestamp: Date.now(),
          };
        }

        // ========== Spec Discovery ==========
        case "getSpecs": {
          return handleGetSpecs();
        }

        // ========== AI Commands ==========
        case "aiSearch": {
          const { createSearchEngine } = await import("@qontinui/ui-bridge/ai");
          const searchEngine = createSearchEngine({ includeHidden: true });
          // Use findElements() for fresh DOM scan instead of stale useMemo elements
          const freshElements = await findElements();
          searchEngine.updateElements(freshElements.elements);
          const criteria = payload as Parameters<typeof searchEngine.search>[0];
          if (criteria.fuzzy === undefined) {
            criteria.fuzzy = true;
          }
          const searchResponse = searchEngine.search(criteria);
          return {
            results: searchResponse.results,
            total: searchResponse.results.length,
            scannedCount: freshElements.elements.length,
            timestamp: Date.now(),
          };
        }

        case "aiExecute": {
          const { parseNLInstruction } = await import("@qontinui/ui-bridge/ai");
          const { instruction } = payload as { instruction: string };
          const parsed = parseNLInstruction(instruction);

          if (!parsed) {
            throw new Error(`Could not parse instruction: ${instruction}`);
          }

          const { createSearchEngine } = await import("@qontinui/ui-bridge/ai");
          const searchEngine = createSearchEngine({ includeHidden: true });
          // Use findElements() for fresh DOM scan instead of stale useMemo elements
          const freshExecElements = await findElements();
          searchEngine.updateElements(freshExecElements.elements);

          const searchResponse = searchEngine.search({
            text: parsed.targetDescription,
            fuzzy: true,
          });

          const firstResult = searchResponse.results[0];
          if (!firstResult) {
            throw new Error(
              `No element found matching: ${parsed.targetDescription}`
            );
          }

          const targetElement = firstResult.element;
          const domElement = (getElement(targetElement.id)?.element ??
            null) as HTMLElement | null;

          if (!domElement) {
            throw new Error(`DOM element not found for ${targetElement.id}`);
          }

          switch (parsed.action) {
            case "click":
              domElement.click();
              break;
            case "type":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                domElement.value = parsed.value || "";
                domElement.dispatchEvent(new Event("input", { bubbles: true }));
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "select":
              if (domElement instanceof HTMLSelectElement) {
                domElement.value = parsed.value || "";
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "check":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = true;
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "uncheck":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = false;
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            default:
              throw new Error(`Unsupported action: ${parsed.action}`);
          }

          return {
            success: true,
            executedAction: `${parsed.action} on ${targetElement.id}`,
            elementUsed: targetElement,
            confidence: firstResult.confidence,
          };
        }

        case "aiAssert": {
          const { createAssertionExecutor } =
            await import("@qontinui/ui-bridge/ai");
          type AssertionType = import("@qontinui/ui-bridge/ai").AssertionType;
          const executor = createAssertionExecutor({});
          // Use findElements() for fresh DOM scan instead of stale useMemo elements
          const freshAssertElements = await findElements();
          executor.updateElements(
            freshAssertElements.elements as unknown as Parameters<
              typeof executor.updateElements
            >[0]
          );
          const assertionRequest = payload as {
            target: string;
            type: string;
            expected?: unknown;
          };
          const result = await executor.assert({
            target: assertionRequest.target,
            type: assertionRequest.type as AssertionType,
            expected: assertionRequest.expected,
          });
          return result;
        }

        case "aiAssertBatch": {
          const { createAssertionExecutor } =
            await import("@qontinui/ui-bridge/ai");
          type AssertionType = import("@qontinui/ui-bridge/ai").AssertionType;
          const executor = createAssertionExecutor({});
          // Use findElements() for fresh DOM scan instead of stale useMemo elements
          const freshBatchElements = await findElements();
          executor.updateElements(
            freshBatchElements.elements as unknown as Parameters<
              typeof executor.updateElements
            >[0]
          );
          const batchRequest = payload as {
            assertions: Array<{
              target: string;
              type: string;
              expected?: unknown;
            }>;
            mode?: "all" | "any";
          };
          const result = await executor.assertBatch({
            assertions: batchRequest.assertions.map((a) => ({
              target: a.target,
              type: a.type as AssertionType,
              expected: a.expected,
            })),
            mode: batchRequest.mode || "all",
          });
          return result;
        }

        case "getSemanticSnapshot": {
          const { createSnapshotManager } =
            await import("@qontinui/ui-bridge/ai");
          const manager = createSnapshotManager({});
          // Use createSnapshot() for fresh data instead of stale useMemo elements
          const freshSnapshot = createSnapshot();
          const controlSnapshot = {
            timestamp: Date.now(),
            elements: freshSnapshot.elements.map((e) => ({
              id: e.id,
              type: e.type,
              label: e.label,
              actions: e.actions,
              state: e.state,
            })),
            components: [],
            workflows: [],
            activeRuns: [],
          };
          return manager.createSnapshot(controlSnapshot);
        }

        case "getSemanticDiff": {
          return null;
        }

        case "getPageSummary": {
          const { generatePageSummary } =
            await import("@qontinui/ui-bridge/ai");
          const aiElements = elements.map((e) => ({
            id: e.id,
            type: e.type,
            label: e.label,
            tagName: e.element.tagName.toLowerCase(),
            actions: e.actions as string[],
            state: e.getState(),
            registered: true,
            description: e.description || e.label || e.id,
            aliases: e.aliases || [],
            suggestedActions: [],
          }));
          return generatePageSummary(
            aiElements as Parameters<typeof generatePageSummary>[0]
          );
        }

        // ========== Page Navigation ==========
        case "pageRefresh": {
          window.location.reload();
          return {
            success: true,
            url: window.location.href,
            timestamp: Date.now(),
          };
        }

        case "pageNavigate": {
          const { url } = payload as { url: string };
          if (!url) throw new Error("URL is required");
          window.location.href = url;
          return { success: true, url, timestamp: Date.now() };
        }

        case "pageGoBack": {
          window.history.back();
          return {
            success: true,
            url: window.location.href,
            timestamp: Date.now(),
          };
        }

        case "pageGoForward": {
          window.history.forward();
          return {
            success: true,
            url: window.location.href,
            timestamp: Date.now(),
          };
        }

        // ========== Debug ==========
        case "getActionHistory": {
          return [];
        }

        case "getTabInfo": {
          return {
            url: window.location.href,
            pathname: window.location.pathname,
            title: document.title,
            timestamp: Date.now(),
          };
        }

        case "getElementTree": {
          return {
            root: document.title,
            elements: elements.length,
            tree: elements.slice(0, 50).map((e) => ({
              id: e.id,
              tag: e.element.tagName.toLowerCase(),
              text: (e.label ?? e.element.textContent ?? "").slice(0, 50),
            })),
          };
        }

        case "captureSnapshot": {
          return {
            captured: true,
            timestamp: Date.now(),
          };
        }

        case "getConsoleErrors": {
          const w = window as unknown as Record<string, unknown>;
          const bridge = w.__UI_BRIDGE__ as Record<string, unknown> | undefined;
          const capture = bridge?.browserCapture as
            | {
                getConsoleSince(ts: number): unknown[];
                getConsoleRecent(n?: number): unknown[];
              }
            | undefined;
          if (!capture) {
            return { errors: [], count: 0 };
          }
          const { since, limit } = payload as {
            since?: number;
            limit?: number;
          };
          const errors = since
            ? capture.getConsoleSince(since)
            : capture.getConsoleRecent(limit ?? 50);
          return { errors, count: errors.length };
        }

        // ========== Performance Diagnostics ==========
        case "getPerformanceEntries": {
          const entries: Record<string, unknown> = {};
          const navEntries = performance.getEntriesByType(
            "navigation"
          ) as PerformanceNavigationTiming[];
          const n = navEntries[0];
          if (n) {
            entries.navigation = {
              ttfbMs: Math.round(n.responseStart - n.requestStart),
              domInteractiveMs: Math.round(n.domInteractive),
              domCompleteMs: Math.round(n.domComplete),
              loadEventMs: Math.round(n.loadEventEnd),
              redirectMs: Math.round(n.redirectEnd - n.redirectStart),
              dnsMs: Math.round(n.domainLookupEnd - n.domainLookupStart),
              tcpMs: Math.round(n.connectEnd - n.connectStart),
            };
          }
          const resEntries = performance.getEntriesByType(
            "resource"
          ) as PerformanceResourceTiming[];
          entries.resources = resEntries.map((e) => ({
            name: e.name,
            initiatorType: e.initiatorType,
            startTime: Math.round(e.startTime),
            duration: Math.round(e.duration),
            transferSize: e.transferSize ?? 0,
            ttfbMs: Math.round(e.responseStart - e.requestStart),
            downloadMs: Math.round(e.responseEnd - e.responseStart),
          }));
          entries.paint = performance.getEntriesByType("paint").map((e) => ({
            name: e.name,
            startTime: Math.round(e.startTime),
          }));
          return entries;
        }

        case "clearPerformanceEntries": {
          performance.clearResourceTimings();
          return { cleared: true };
        }

        case "getBrowserEvents": {
          const {
            type,
            since: evtSince,
            limit: evtLimit,
          } = payload as { type?: string; since?: number; limit?: number };
          const w2 = window as unknown as Record<string, unknown>;
          const bridge2 = w2.__UI_BRIDGE__ as
            | Record<string, unknown>
            | undefined;
          const capture2 = bridge2?.browserCapture as
            | {
                getByType(t: string): unknown[];
                getSince(ts: number): unknown[];
                getRecent(n?: number): unknown[];
              }
            | undefined;
          if (!capture2) return { events: [], count: 0 };
          let events: unknown[];
          if (type) events = capture2.getByType(type);
          else if (evtSince) events = capture2.getSince(evtSince);
          else events = capture2.getRecent(evtLimit ?? 100);
          return { events, count: events.length };
        }

        // ========== Idle Detection ==========
        case "getIdleStatus": {
          const detector = getIdleDetector();
          return detector.getStatus();
        }

        case "getIdleSignalStatus": {
          const detector = getIdleDetector();
          const { signal: sigName } = payload as { signal: string };
          const sigStatus = detector.getSignalStatus(sigName);
          if (!sigStatus) {
            throw new Error(
              `Signal not found: ${sigName}. Available: ${detector.getSignalNames().join(", ")}`
            );
          }
          return sigStatus;
        }

        case "waitForIdle": {
          const detector = getIdleDetector();
          const idleOpts = payload as {
            timeout?: number;
            minStableMs?: number;
            exclude?: string[];
          };
          return detector.waitForIdle(idleOpts);
        }

        case "waitForSignalIdle": {
          const detector = getIdleDetector();
          const sigWait = payload as {
            signal: string;
            timeout?: number;
            minStableMs?: number;
          };
          return detector.waitForSignal(sigWait.signal, {
            timeout: sigWait.timeout,
            minStableMs: sigWait.minStableMs,
          });
        }

        case "waitForTargets": {
          const detector = getIdleDetector();
          const tgtOpts = payload as {
            targets: Array<string | { indicator: string }>;
            timeout?: number;
            minStableMs?: number;
          };
          return detector.waitFor(tgtOpts.targets, {
            timeout: tgtOpts.timeout,
            minStableMs: tgtOpts.minStableMs,
          });
        }

        default:
          throw new Error(`Unknown command action: ${action}`);
      }
    },
    [elements, getElement, createSnapshot, findElements]
  );

  /**
   * Send a response back via WebSocket
   */
  const sendWSResponse = useCallback(
    (response: WSCommandResponse) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(response));
        log("Sent WebSocket response:", response.commandId, response.success);
      }
    },
    [log]
  );

  /**
   * Handle incoming WebSocket command
   */
  const handleWSCommand = useCallback(
    async (command: WSCommand) => {
      const { commandId, action, payload } = command;
      log("Received WebSocket command:", action, commandId);

      try {
        const result = await executeCommand(
          action,
          payload as Record<string, unknown>
        );

        sendWSResponse({
          type: "command_response",
          commandId,
          success: true,
          result,
          timestamp: Date.now(),
        });
      } catch (e: unknown) {
        sendWSResponse({
          type: "command_response",
          commandId,
          success: false,
          error: (e as Error).message,
          timestamp: Date.now(),
        });
      }
    },
    [executeCommand, sendWSResponse, log]
  );

  /**
   * Handle WebSocket messages
   */
  const handleWSMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        log("WebSocket message received:", message.type);

        switch (message.type) {
          case "command":
            handleWSCommand(message as WSCommand);
            break;

          case "command_ack":
            log("Command acknowledged:", (message as WSCommandAck).commandId);
            break;

          default:
            log("Unknown WebSocket message type:", message.type);
        }
      } catch (parseError: unknown) {
        console.error(
          "[UIBridgeTransport] Failed to parse WebSocket message:",
          parseError
        );
      }
    },
    [handleWSCommand, log]
  );

  /**
   * Connect WebSocket
   */
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      log("WebSocket already connected");
      return;
    }

    isIntentionallyClosed.current = false;
    setConnectionState("connecting");

    // Build WebSocket URL
    const baseUrl =
      wsUrl ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${WEBSOCKET_ENDPOINT}`;

    log("Connecting to WebSocket:", baseUrl);

    try {
      const ws = new WebSocket(baseUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log("WebSocket connected");
        setConnectionState("connected");
        setActiveTransport("websocket");
        setReconnectAttempts(0);

        // Stop SSE if running (WebSocket takes priority)
        stopSSE();

        // Send command_ready message
        const readyMessage: WSCommandReady = {
          type: "command_ready",
          clientId: clientIdRef.current,
          timestamp: Date.now(),
        };
        ws.send(JSON.stringify(readyMessage));
      };

      ws.onclose = (closeEvent) => {
        log("WebSocket disconnected:", closeEvent.code, closeEvent.reason);
        wsRef.current = null;

        if (isIntentionallyClosed.current) {
          setConnectionState("disconnected");
          setActiveTransport("none");
          return;
        }

        // Attempt reconnection or fallback
        if (mode === "auto") {
          // Start SSE as fallback
          log("Falling back to SSE stream");
          startSSE();
        }

        // Schedule reconnection
        setConnectionState("reconnecting");
        setReconnectAttempts((prev) => {
          const newAttempts = prev + 1;
          const delay = calculateReconnectDelay(newAttempts);
          log(`Scheduling reconnection attempt ${newAttempts} in ${delay}ms`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);

          return newAttempts;
        });
      };

      ws.onerror = () => {
        // WebSocket errors are expected when the endpoint isn't available.
        // In 'auto' mode, we'll fall back to HTTP polling silently.
        // Only log in verbose mode or when WebSocket is explicitly required.
        if (mode === "websocket") {
          console.error(
            "[UIBridgeTransport] WebSocket connection failed (websocket-only mode)"
          );
        } else if (verbose) {
          console.debug(
            "[UIBridgeTransport] WebSocket unavailable, will use HTTP fallback"
          );
        }
      };

      ws.onmessage = handleWSMessage;
    } catch (wsError: unknown) {
      // WebSocket creation can fail in environments that don't support it
      if (mode === "websocket") {
        console.error(
          "[UIBridgeTransport] Failed to create WebSocket:",
          wsError
        );
      } else if (verbose) {
        console.debug(
          "[UIBridgeTransport] WebSocket creation failed, using HTTP fallback:",
          wsError
        );
      }
      setConnectionState("disconnected");

      if (mode === "auto") {
        startSSE();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, mode, verbose, handleWSMessage, log]);

  /**
   * Process a single SSE command
   */
  const processSSECommand = useCallback(
    async (command: QueuedCommand) => {
      try {
        const result = await executeCommand(
          command.action,
          command.payload as Record<string, unknown>
        );

        await fetch(COMMANDS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: command.commandId,
            success: true,
            result,
          }),
        });
      } catch (cmdError: unknown) {
        await fetch(COMMANDS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: command.commandId,
            success: false,
            error: (cmdError as Error).message,
          }),
        });
      }
    },
    [executeCommand]
  );

  /**
   * Start SSE connection (replaces HTTP polling)
   */
  const startSSE = useCallback(() => {
    if (eventSourceRef.current) {
      return; // Already connected
    }

    log("Starting SSE stream");
    setActiveTransport("sse");
    setConnectionState("connected");

    const es = new EventSource(
      `${COMMANDS_STREAM_ENDPOINT}?tabId=${clientIdRef.current}`
    );
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Skip the initial connection event
        if (data.type === "connected") {
          log("SSE stream connected");
          return;
        }

        // Process commands
        if (data.commandId && data.action) {
          processSSECommand(data as QueuedCommand);
        }
      } catch (e) {
        console.error("[UIBridgeTransport] Failed to parse SSE message:", e);
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      if (isIntentionallyClosed.current) return;

      // Reconnect after delay (always, regardless of tab visibility)
      sseReconnectTimeoutRef.current = setTimeout(() => {
        if (!isIntentionallyClosed.current) {
          log("Reconnecting SSE stream...");
          startSSE();
        }
      }, SSE_RECONNECT_DELAY_MS);
    };
  }, [processSSECommand, log]);

  /**
   * Stop SSE connection
   */
  const stopSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      log("Stopped SSE stream");
    }
    if (sseReconnectTimeoutRef.current) {
      clearTimeout(sseReconnectTimeoutRef.current);
      sseReconnectTimeoutRef.current = null;
    }
  }, [log]);

  /**
   * Disconnect all transports
   */
  const disconnect = useCallback(() => {
    log("Disconnecting transport");
    isIntentionallyClosed.current = true;

    // Clear reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop SSE
    stopSSE();

    setConnectionState("disconnected");
    setActiveTransport("none");
    setReconnectAttempts(0);
  }, [stopSSE, log]);

  /**
   * Reconnect transport
   */
  const reconnect = useCallback(() => {
    log("Manual reconnection requested");
    disconnect();

    // Reset state
    isIntentionallyClosed.current = false;
    setReconnectAttempts(0);

    // Connect based on mode
    if (mode === "http") {
      startSSE();
    } else {
      connectWebSocket();
    }
  }, [disconnect, mode, startSSE, connectWebSocket, log]);

  /**
   * Handle tab visibility changes to pause/resume polling
   */
  const handleVisibilityChange = useCallback(() => {
    const isVisible = document.visibilityState === "visible";
    const wasVisible = isTabVisibleRef.current;
    isTabVisibleRef.current = isVisible;

    if (isVisible && !wasVisible) {
      // Tab became visible — reconnect WebSocket if needed (SSE stays connected)
      log("Tab became visible");
      if (activeTransport === "websocket" || activeTransport === "none") {
        if (
          wsRef.current?.readyState !== WebSocket.OPEN &&
          !isIntentionallyClosed.current
        ) {
          log("Reconnecting WebSocket after tab became visible");
          connectWebSocket();
        }
      }
    }
    // Tab hidden: keep all transports connected (SSE and WebSocket are low overhead)
  }, [activeTransport, log, connectWebSocket]);

  /**
   * Set up visibility change listener
   */
  useEffect(() => {
    if (typeof document === "undefined") return;

    // Initialize visibility state
    isTabVisibleRef.current = document.visibilityState === "visible";

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  /**
   * Initialize transport on mount
   */
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    log("Initializing transport, mode:", mode);

    if (mode === "http") {
      startSSE();
    } else {
      // 'websocket' or 'auto' - try WebSocket first
      connectWebSocket();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode]);

  return {
    connectionState,
    activeTransport,
    isReady: connectionState === "connected",
    reconnectAttempts,
    reconnect,
    disconnect,
  };
}
