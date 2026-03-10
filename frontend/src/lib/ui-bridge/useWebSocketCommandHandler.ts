"use client";

/**
 * WebSocket-based UI Bridge Command Handler
 *
 * This hook provides a command handler function that can be passed to
 * RunnerWebSocket to handle UI Bridge commands via WebSocket instead of
 * HTTP polling.
 *
 * Benefits over polling:
 * - Lower latency (instant delivery vs 500ms polling interval)
 * - No wasted requests when no commands are pending
 * - Better suited for real-time automation
 *
 * Usage:
 * ```tsx
 * const { handleCommand, connect, disconnect, isConnected } = useWebSocketCommandHandler();
 *
 * // Option 1: Pass to RunnerWebSocket config
 * const ws = createRunnerWebSocket({
 *   url: wsUrl,
 *   uiBridgeCommandHandler: handleCommand,
 * });
 *
 * // Option 2: Use built-in WebSocket connection
 * useEffect(() => {
 *   connect('ws://localhost:3001/api/ui-bridge/ws');
 *   return () => disconnect();
 * }, []);
 * ```
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { useUIBridge } from "@qontinui/ui-bridge/react";
import { CompositeIdleDetector } from "@qontinui/ui-bridge";
import type { ControlSnapshot } from "@qontinui/ui-bridge/control";

// Reconnection configuration
const INITIAL_RECONNECT_DELAY_MS = 1000;
const RECONNECT_MULTIPLIER = 1.5;
const MAX_RECONNECT_DELAY_MS = 30000;
const JITTER_FACTOR = 0.1; // +/- 10%

/**
 * Connection state for the WebSocket handler
 */
export type WebSocketConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * Calculate reconnection delay with jitter
 */
function calculateReconnectDelay(attempt: number): number {
  const baseDelay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_MULTIPLIER, attempt - 1),
    MAX_RECONNECT_DELAY_MS
  );
  const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.round(baseDelay + jitter);
}

/**
 * Generate a unique client ID
 */
function generateClientId(): string {
  return `ws_handler_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Hook that provides a WebSocket-compatible command handler
 * for UI Bridge commands.
 *
 * This reuses the same command execution logic as useUIBridgeCommandHandler
 * but designed to be called directly from WebSocket message handlers.
 *
 * Features:
 * - Command execution logic compatible with WebSocket message handlers
 * - Built-in WebSocket connection management with auto-reconnection
 * - Exponential backoff with jitter for reconnection attempts
 */
export function useWebSocketCommandHandler() {
  const bridge = useUIBridge();

  // Connection state
  const [connectionState, setConnectionState] =
    useState<WebSocketConnectionState>("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(generateClientId());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionallyClosed = useRef(false);
  const idleDetectorRef = useRef<CompositeIdleDetector | null>(null);

  function getIdleDetector(): CompositeIdleDetector {
    if (!idleDetectorRef.current) {
      idleDetectorRef.current = CompositeIdleDetector.create();
    }
    return idleDetectorRef.current;
  }

  useEffect(() => {
    return () => {
      if (idleDetectorRef.current) {
        idleDetectorRef.current.destroy();
        idleDetectorRef.current = null;
      }
    };
  }, []);

  /**
   * Read all specs from the global SpecStore
   */
  function handleGetSpecs(): {
    specs: Array<{ specId: string; config: unknown }>;
  } {
    try {
      const w = window as unknown as Record<string, unknown>;
      // Try window.__QONTINUI_SPEC_STORE__ first (set by usePageSpecs)
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
      // Fallback: try __UI_BRIDGE__.specs.getGlobalSpecStore()
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
   * Execute a UI Bridge command and return the result
   */
  const handleCommand = useCallback(
    async (
      action: string,
      payload: Record<string, unknown>
    ): Promise<unknown> => {
      switch (action) {
        // ========== Control Snapshot ==========
        case "getControlSnapshot": {
          // Build page context from NavigationTracker if available
          const w = window as unknown as Record<string, unknown>;
          const uiBridgeGlobal = w.__UI_BRIDGE__ as
            | Record<string, unknown>
            | undefined;
          const navTracker = uiBridgeGlobal?.navigationTracker as
            | { getSnapshotPageContext: () => unknown }
            | undefined;
          const modalDetector = uiBridgeGlobal?.modalDetector as
            | { getSnapshotModalContext: () => unknown }
            | undefined;
          const toastCap = uiBridgeGlobal?.toastCapture as
            | { getSnapshotToastContext: () => unknown }
            | undefined;
          const relTracker = uiBridgeGlobal?.relationshipTracker as
            | {
                getSnapshotRelationshipContext: (
                  elements?: Array<{ id: string; element: Element }>
                ) => unknown;
              }
            | undefined;
          const dndDetector = uiBridgeGlobal?.dragDropDetector as
            | {
                getSnapshotDragDropContext: (
                  elements?: Array<{ id: string; element: Element }>
                ) => unknown;
              }
            | undefined;

          const elementPairs = bridge.elements.map((e) => ({
            id: e.id,
            element: e.element,
          }));
          const snapshot: ControlSnapshot = {
            timestamp: Date.now(),
            elements: bridge.elements.map((e) => {
              const state = e.getState();
              return {
                id: e.id,
                type: e.type,
                label: e.label,
                actions: e.actions,
                state: state,
              };
            }),
            components: [],
            workflows: [],
            activeRuns: [],
            page: navTracker?.getSnapshotPageContext() as ControlSnapshot["page"],
            modalStack:
              modalDetector?.getSnapshotModalContext() as ControlSnapshot["modalStack"],
            toasts:
              toastCap?.getSnapshotToastContext() as ControlSnapshot["toasts"],
            relationships: relTracker?.getSnapshotRelationshipContext(
              elementPairs
            ) as ControlSnapshot["relationships"],
            dragDrop: dndDetector?.getSnapshotDragDropContext(
              elementPairs
            ) as ControlSnapshot["dragDrop"],
          };
          return snapshot;
        }

        // ========== Element Actions ==========
        case "getElementState": {
          const { id } = payload;
          const element = bridge.getElement(id as string);
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
          const element = bridge.getElement(id);
          if (!element) {
            throw new Error(`Element ${id} not found`);
          }

          // Get the DOM element from the bridge registry
          const domElement = element.element as HTMLElement | null;
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
                const typeProto =
                  domElement instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                const typeSetter = Object.getOwnPropertyDescriptor(
                  typeProto,
                  "value"
                )?.set;
                const text = request.params?.text || request.text || "";
                if (request.params?.clear || request.clear) {
                  if (typeSetter) typeSetter.call(domElement, "");
                  else domElement.value = "";
                  domElement.dispatchEvent(
                    new Event("input", { bubbles: true })
                  );
                }
                domElement.focus();
                const current = domElement.value;
                if (typeSetter) typeSetter.call(domElement, current + text);
                else domElement.value = current + text;
                domElement.dispatchEvent(new Event("input", { bubbles: true }));
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "clear":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                const clearProto =
                  domElement instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                const clearSetter = Object.getOwnPropertyDescriptor(
                  clearProto,
                  "value"
                )?.set;
                if (clearSetter) clearSetter.call(domElement, "");
                else domElement.value = "";
                domElement.dispatchEvent(new Event("input", { bubbles: true }));
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              break;
            case "setValue":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                const setProto =
                  domElement instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  setProto,
                  "value"
                )?.set;
                if (nativeSetter) {
                  nativeSetter.call(domElement, request.value || "");
                } else {
                  domElement.value = request.value || "";
                }
                domElement.dispatchEvent(new Event("input", { bubbles: true }));
                domElement.dispatchEvent(
                  new Event("change", { bubbles: true })
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
          const domElement = (bridge.getElement(id as string)?.element ??
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

          const elements = bridge.elements;
          return {
            elements: elements.map((e) => {
              const state = e.getState();
              return {
                id: e.id,
                type: e.type,
                label: e.label,
                tagName: e.element.tagName.toLowerCase(),
                role: e.element.getAttribute("role") ?? undefined,
                accessibleName: e.element.getAttribute("aria-label") ?? e.label,
                actions: e.actions,
                state: state,
                registered: true,
              };
            }),
            total: elements.length,
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
          // Import AI search functionality dynamically
          const { createSearchEngine } = await import("@qontinui/ui-bridge/ai");
          const searchEngine = createSearchEngine({ includeHidden: true });
          searchEngine.updateElements(bridge.elements);
          // Default to fuzzy matching for AI search (bypasses visibility filter, enables fuzzy)
          const searchCriteria = {
            fuzzy: true,
            ...(payload as Parameters<typeof searchEngine.search>[0]),
          };
          const response = searchEngine.search(searchCriteria);
          return {
            results: response.results,
            total: response.results.length,
            scannedCount: response.scannedCount,
            timestamp: Date.now(),
          };
        }

        case "aiExecute": {
          // Parse natural language and execute
          const { parseNLInstruction } = await import("@qontinui/ui-bridge/ai");
          const { instruction } = payload as { instruction: string };
          const parsed = parseNLInstruction(instruction);

          if (!parsed) {
            throw new Error(`Could not parse instruction: ${instruction}`);
          }

          // Find the target element
          const { createSearchEngine } = await import("@qontinui/ui-bridge/ai");
          const searchEngine = createSearchEngine({ includeHidden: true });
          searchEngine.updateElements(bridge.elements);

          const searchResponse = searchEngine.search({
            text: parsed.targetDescription,
            fuzzy: true,
          });

          if (searchResponse.results.length === 0) {
            throw new Error(
              `No element found matching: ${parsed.targetDescription}`
            );
          }

          const targetElement = searchResponse.results[0]!.element;
          const domElement = (bridge.getElement(targetElement.id)?.element ??
            null) as HTMLElement | null;

          if (!domElement) {
            throw new Error(`DOM element not found for ${targetElement.id}`);
          }

          // Execute the action
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
            confidence: searchResponse.results[0]!.confidence,
          };
        }

        case "aiAssert": {
          const { createAssertionExecutor } =
            await import("@qontinui/ui-bridge/ai");
          type AssertionType = import("@qontinui/ui-bridge/ai").AssertionType;
          const executor = createAssertionExecutor({});
          executor.updateElements(
            bridge.elements as unknown as Parameters<
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
          executor.updateElements(
            bridge.elements as unknown as Parameters<
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
          const controlSnapshot = {
            timestamp: Date.now(),
            elements: bridge.elements.map((e) => ({
              id: e.id,
              type: e.type,
              label: e.label,
              actions: e.actions,
              state: e.getState(),
            })),
            components: [],
            workflows: [],
            activeRuns: [],
          };
          return manager.createSnapshot(controlSnapshot);
        }

        case "getSemanticDiff": {
          // Semantic diff requires previous snapshot tracking - not implemented
          return null;
        }

        case "getPageSummary": {
          const { generatePageSummary } =
            await import("@qontinui/ui-bridge/ai");
          // Convert RegisteredElement[] to minimal AIDiscoveredElement-like objects for the summary
          const aiElements = bridge.elements.map((e) => ({
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

        // ========== Debug ==========
        case "getActionHistory": {
          // Return empty for now - could be tracked
          return [];
        }

        case "getElementTree": {
          // Build a tree representation
          const elements = bridge.elements;
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
          // Trigger render log snapshot
          return {
            captured: true,
            timestamp: Date.now(),
          };
        }

        // ========== Idle Detection ==========
        case "getIdleStatus": {
          const detector = getIdleDetector();
          return detector.getStatus();
        }

        case "getIdleSignalStatus": {
          const detector = getIdleDetector();
          const { signal } = payload as { signal: string };
          const status = detector.getSignalStatus(signal);
          if (!status) {
            throw new Error(
              `Signal not found: ${signal}. Available: ${detector.getSignalNames().join(", ")}`
            );
          }
          return status;
        }

        case "waitForIdle": {
          const detector = getIdleDetector();
          const { timeout, minStableMs, exclude } = payload as {
            timeout?: number;
            minStableMs?: number;
            exclude?: string[];
          };
          return detector.waitForIdle({ timeout, minStableMs, exclude });
        }

        case "waitForSignalIdle": {
          const detector = getIdleDetector();
          const waitSignalPayload = payload as {
            signal: string;
            timeout?: number;
            minStableMs?: number;
          };
          return detector.waitForSignal(waitSignalPayload.signal, {
            timeout: waitSignalPayload.timeout,
            minStableMs: waitSignalPayload.minStableMs,
          });
        }

        case "waitForTargets": {
          const detector = getIdleDetector();
          const targetsPayload = payload as {
            targets: Array<string | { indicator: string }>;
            timeout?: number;
            minStableMs?: number;
          };
          return detector.waitFor(targetsPayload.targets, {
            timeout: targetsPayload.timeout,
            minStableMs: targetsPayload.minStableMs,
          });
        }

        default:
          throw new Error(`Unknown command action: ${action}`);
      }
    },
    [bridge]
  );

  /**
   * Send a response back via WebSocket
   */
  const sendResponse = useCallback(
    (commandId: string, success: boolean, result?: unknown, error?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const response = {
          type: "command_response",
          commandId,
          success,
          result,
          error,
          timestamp: Date.now(),
        };
        wsRef.current.send(JSON.stringify(response));
      }
    },
    []
  );

  /**
   * Handle incoming WebSocket message
   */
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "command") {
          const { commandId, action, payload } = message;

          try {
            const result = await handleCommand(
              action,
              payload as Record<string, unknown>
            );
            sendResponse(commandId, true, result);
          } catch (e) {
            sendResponse(commandId, false, undefined, (e as Error).message);
          }
        } else if (message.type === "command_ack") {
          // Acknowledgment received
          console.log(
            "[WebSocketCommandHandler] Command acknowledged:",
            message.commandId
          );
        }
      } catch (e) {
        console.error("[WebSocketCommandHandler] Failed to parse message:", e);
      }
    },
    [handleCommand, sendResponse]
  );

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(
    (url: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.warn("[WebSocketCommandHandler] Already connected");
        return;
      }

      isIntentionallyClosed.current = false;
      setConnectionState("connecting");

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[WebSocketCommandHandler] Connected");
          setConnectionState("connected");
          setReconnectAttempts(0);

          // Send ready message
          ws.send(
            JSON.stringify({
              type: "command_ready",
              clientId: clientIdRef.current,
              timestamp: Date.now(),
            })
          );
        };

        ws.onclose = (event) => {
          console.log(
            "[WebSocketCommandHandler] Disconnected:",
            event.code,
            event.reason
          );
          wsRef.current = null;

          if (isIntentionallyClosed.current) {
            setConnectionState("disconnected");
            return;
          }

          // Schedule reconnection
          setConnectionState("reconnecting");
          setReconnectAttempts((prev) => {
            const newAttempts = prev + 1;
            const delay = calculateReconnectDelay(newAttempts);

            reconnectTimeoutRef.current = setTimeout(() => {
              connect(url);
            }, delay);

            return newAttempts;
          });
        };

        ws.onerror = (error) => {
          console.error("[WebSocketCommandHandler] Error:", error);
        };

        ws.onmessage = handleMessage;
      } catch (e) {
        console.error("[WebSocketCommandHandler] Failed to connect:", e);
        setConnectionState("disconnected");
      }
    },
    [handleMessage]
  );

  /**
   * Disconnect from WebSocket server
   */
  const disconnect = useCallback(() => {
    isIntentionallyClosed.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionState("disconnected");
    setReconnectAttempts(0);
  }, []);

  /**
   * Check if WebSocket is connected
   */
  const isConnected = useCallback(() => {
    return wsRef.current?.readyState === WebSocket.OPEN;
  }, []);

  return {
    handleCommand,
    sendResponse,
    connect,
    disconnect,
    isConnected,
    connectionState,
    reconnectAttempts,
    clientId: clientIdRef.current,
  };
}
