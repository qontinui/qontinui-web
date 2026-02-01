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

import { useCallback, useRef, useState } from "react";
import { useUIBridge } from "ui-bridge/react";
import type { ControlSnapshot } from "ui-bridge/control";

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
          const snapshot: ControlSnapshot = {
            timestamp: Date.now(),
            elements: bridge.elements.map((e) => ({
              id: e.id,
              tagName: e.tagName,
              type: e.type,
              text: e.text,
              isVisible: e.isVisible,
              isEnabled: e.isEnabled,
              rect: e.rect,
              attributes: e.attributes,
              componentName: e.componentName,
              aliases: e.aliases,
            })),
            components: [],
            workflows: [],
            activeRuns: [],
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
          return {
            id: element.id,
            isVisible: element.isVisible,
            isEnabled: element.isEnabled,
            text: element.text,
            value: element.value,
            checked: element.checked,
            rect: element.rect,
          };
        }

        case "executeElementAction": {
          const { id, request } = payload as {
            id: string;
            request: { action: string; value?: string };
          };
          const element = bridge.getElement(id);
          if (!element) {
            throw new Error(`Element ${id} not found`);
          }

          // Get the DOM element
          const domElement = document.querySelector(
            `[data-ui-id="${id}"]`
          ) as HTMLElement | null;
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
            case "setValue":
              if (
                domElement instanceof HTMLInputElement ||
                domElement instanceof HTMLTextAreaElement
              ) {
                domElement.value = request.value || "";
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
          const domElement = document.querySelector(
            `[data-ui-id="${id}"]`
          ) as HTMLElement | null;
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
          const elements = bridge.elements;
          return {
            elements: elements.map((e) => ({
              id: e.id,
              tagName: e.tagName,
              type: e.type,
              text: e.text,
              isVisible: e.isVisible,
              isEnabled: e.isEnabled,
              rect: e.rect,
              aliases: e.aliases,
            })),
            total: elements.length,
            durationMs: 0,
            timestamp: Date.now(),
          };
        }

        // ========== AI Commands ==========
        case "aiSearch": {
          // Import AI search functionality dynamically
          const { createSearchEngine } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const searchEngine = createSearchEngine({}, elements);
          const response = searchEngine.search(
            payload as Parameters<typeof searchEngine.search>[0]
          );
          return {
            results: response.results,
            total: response.results.length,
            timestamp: Date.now(),
          };
        }

        case "aiExecute": {
          // Parse natural language and execute
          const { parseNLInstruction } = await import("ui-bridge/ai");
          const { instruction } = payload as { instruction: string };
          const parsed = parseNLInstruction(instruction);

          if (!parsed) {
            throw new Error(`Could not parse instruction: ${instruction}`);
          }

          // Find the target element
          const { createSearchEngine } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const searchEngine = createSearchEngine({}, elements);

          const searchResponse = searchEngine.search({
            text: parsed.targetDescription,
            fuzzy: true,
          });

          if (searchResponse.results.length === 0) {
            throw new Error(
              `No element found matching: ${parsed.targetDescription}`
            );
          }

          const targetElement = searchResponse.results[0].element;
          const domElement = document.querySelector(
            `[data-ui-id="${targetElement.id}"]`
          ) as HTMLElement | null;

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
            confidence: searchResponse.results[0].confidence,
          };
        }

        case "aiAssert": {
          const { createAssertionExecutor } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const executor = createAssertionExecutor({}, elements, (id: string) => {
            const el = document.querySelector(
              `[data-ui-id="${id}"]`
            ) as HTMLElement | null;
            if (!el) return null;
            return {
              isVisible:
                el.offsetParent !== null &&
                getComputedStyle(el).visibility !== "hidden",
              isEnabled: !(el as HTMLButtonElement).disabled,
              isFocused: document.activeElement === el,
              isChecked: (el as HTMLInputElement).checked,
              text: el.textContent || "",
              value: (el as HTMLInputElement).value,
            };
          });
          const result = await executor.assert(
            payload as Parameters<typeof executor.assert>[0]
          );
          return result;
        }

        case "aiAssertBatch": {
          const { createAssertionExecutor } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const executor = createAssertionExecutor({}, elements, (id: string) => {
            const el = document.querySelector(
              `[data-ui-id="${id}"]`
            ) as HTMLElement | null;
            if (!el) return null;
            return {
              isVisible:
                el.offsetParent !== null &&
                getComputedStyle(el).visibility !== "hidden",
              isEnabled: !(el as HTMLButtonElement).disabled,
              isFocused: document.activeElement === el,
              isChecked: (el as HTMLInputElement).checked,
              text: el.textContent || "",
              value: (el as HTMLInputElement).value,
            };
          });
          const result = await executor.assertBatch(
            payload as Parameters<typeof executor.assertBatch>[0]
          );
          return result;
        }

        case "getSemanticSnapshot": {
          const { createSnapshotManager } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const manager = createSnapshotManager({}, elements);
          return manager.capture();
        }

        case "getSemanticDiff": {
          const { createDiffManager } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const manager = createDiffManager({}, elements);
          // This would need previous snapshot tracking - for now return null
          return null;
        }

        case "getPageSummary": {
          const { generatePageSummary } = await import("ui-bridge/ai");
          const elements = bridge.elements;
          const snapshot = {
            timestamp: Date.now(),
            elements,
            components: [],
            workflows: [],
            activeRuns: [],
          };
          return generatePageSummary(snapshot);
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
              tag: e.tagName,
              text: e.text?.slice(0, 50),
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
    (
      commandId: string,
      success: boolean,
      result?: unknown,
      error?: string
    ) => {
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
          console.log("[WebSocketCommandHandler] Command acknowledged:", message.commandId);
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
