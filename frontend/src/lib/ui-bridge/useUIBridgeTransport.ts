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
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useUIBridge } from "ui-bridge/react";
import type { ControlSnapshot } from "ui-bridge/control";

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

// HTTP polling configuration (fallback)
const HTTP_POLL_INTERVAL_MS = 500;

// API endpoints
const COMMANDS_ENDPOINT = "/api/ui-bridge/commands";
const WEBSOCKET_ENDPOINT = "/api/ui-bridge/ws";

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

interface CommandsResponse {
  success: boolean;
  commands: QueuedCommand[];
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
  activeTransport: "websocket" | "http" | "none";

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
 * Generate a unique client ID for WebSocket identification
 */
function generateClientId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
  const { elements, getElement } = useUIBridge();

  // State
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [activeTransport, setActiveTransport] = useState<
    "websocket" | "http" | "none"
  >("none");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(generateClientId());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const httpPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionallyClosed = useRef(false);
  const isPollingRef = useRef(false);

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
          const snapshot: ControlSnapshot = {
            timestamp: Date.now(),
            elements: elements.map((e) => {
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
          };
          return snapshot;
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
            request: { action: string; value?: string };
          };
          const element = getElement(id);
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

        // ========== AI Commands ==========
        case "aiSearch": {
          const { createSearchEngine } = await import("ui-bridge/ai");
          const searchEngine = createSearchEngine({});
          searchEngine.updateElements(elements);
          const searchResponse = searchEngine.search(
            payload as Parameters<typeof searchEngine.search>[0]
          );
          return {
            results: searchResponse.results,
            total: searchResponse.results.length,
            timestamp: Date.now(),
          };
        }

        case "aiExecute": {
          const { parseNLInstruction } = await import("ui-bridge/ai");
          const { instruction } = payload as { instruction: string };
          const parsed = parseNLInstruction(instruction);

          if (!parsed) {
            throw new Error(`Could not parse instruction: ${instruction}`);
          }

          const { createSearchEngine } = await import("ui-bridge/ai");
          const searchEngine = createSearchEngine({});
          searchEngine.updateElements(elements);

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
          const domElement = document.querySelector(
            `[data-ui-id="${targetElement.id}"]`
          ) as HTMLElement | null;

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
          const { createAssertionExecutor } = await import("ui-bridge/ai");
          type AssertionType = import("ui-bridge/ai").AssertionType;
          const executor = createAssertionExecutor({});
          executor.updateElements(
            elements as unknown as Parameters<typeof executor.updateElements>[0]
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
          const { createAssertionExecutor } = await import("ui-bridge/ai");
          type AssertionType = import("ui-bridge/ai").AssertionType;
          const executor = createAssertionExecutor({});
          executor.updateElements(
            elements as unknown as Parameters<typeof executor.updateElements>[0]
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
          const { createSnapshotManager } = await import("ui-bridge/ai");
          const manager = createSnapshotManager({});
          const controlSnapshot = {
            timestamp: Date.now(),
            elements: elements.map((e) => ({
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
          return null;
        }

        case "getPageSummary": {
          const { generatePageSummary } = await import("ui-bridge/ai");
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

        // ========== Debug ==========
        case "getActionHistory": {
          return [];
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

        default:
          throw new Error(`Unknown command action: ${action}`);
      }
    },
    [elements, getElement]
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

        // Stop HTTP polling if running
        if (httpPollIntervalRef.current) {
          clearInterval(httpPollIntervalRef.current);
          httpPollIntervalRef.current = null;
        }

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
          // Start HTTP polling as fallback
          log("Falling back to HTTP polling");
          startHTTPPolling();
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
        startHTTPPolling();
      }
    }
  }, [wsUrl, mode, verbose, handleWSMessage, log]);

  /**
   * Process a single HTTP command
   */
  const processHTTPCommand = useCallback(
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
      } catch (httpError: unknown) {
        await fetch(COMMANDS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: command.commandId,
            success: false,
            error: (httpError as Error).message,
          }),
        });
      }
    },
    [executeCommand]
  );

  /**
   * Poll for HTTP commands
   */
  const pollHTTPCommands = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const response = await fetch(COMMANDS_ENDPOINT);
      if (!response.ok) {
        console.error(
          "[UIBridgeTransport] Failed to poll commands:",
          response.statusText
        );
        return;
      }

      const data: CommandsResponse = await response.json();
      if (data.commands && data.commands.length > 0) {
        await Promise.all(data.commands.map(processHTTPCommand));
      }
    } catch (pollError: unknown) {
      console.error("[UIBridgeTransport] Error polling commands:", pollError);
    } finally {
      isPollingRef.current = false;
    }
  }, [processHTTPCommand]);

  /**
   * Start HTTP polling
   */
  const startHTTPPolling = useCallback(() => {
    if (httpPollIntervalRef.current) {
      return; // Already polling
    }

    log("Starting HTTP polling");
    setActiveTransport("http");
    setConnectionState("connected");

    // Initial poll
    pollHTTPCommands();

    // Set up interval
    httpPollIntervalRef.current = setInterval(
      pollHTTPCommands,
      HTTP_POLL_INTERVAL_MS
    );
  }, [pollHTTPCommands, log]);

  /**
   * Stop HTTP polling
   */
  const stopHTTPPolling = useCallback(() => {
    if (httpPollIntervalRef.current) {
      clearInterval(httpPollIntervalRef.current);
      httpPollIntervalRef.current = null;
      log("Stopped HTTP polling");
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

    // Stop HTTP polling
    stopHTTPPolling();

    setConnectionState("disconnected");
    setActiveTransport("none");
    setReconnectAttempts(0);
  }, [stopHTTPPolling, log]);

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
      startHTTPPolling();
    } else {
      connectWebSocket();
    }
  }, [disconnect, mode, startHTTPPolling, connectWebSocket, log]);

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
      startHTTPPolling();
    } else {
      // 'websocket' or 'auto' - try WebSocket first
      connectWebSocket();
    }

    return () => {
      disconnect();
    };
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
