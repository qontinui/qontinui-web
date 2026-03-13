"use client";

/**
 * UI Bridge Command Handler Hook
 *
 * Receives commands from the server via Server-Sent Events (SSE) and executes
 * them using the UIBridgeRegistry in the browser context. Replaces the previous
 * polling approach to eliminate unnecessary network requests and memory pressure.
 *
 * Usage:
 * Place this hook in a component that wraps your app (like the root layout)
 * to enable remote automation of the UI.
 */

import { useEffect, useRef, useCallback } from "react";
import { useUIBridge } from "@qontinui/ui-bridge/react";
import { buildControlSnapshot } from "./buildControlSnapshot";

// API endpoints
const COMMANDS_RESPONSE_ENDPOINT = "/api/ui-bridge/commands";
const COMMANDS_STREAM_ENDPOINT = "/api/ui-bridge/commands/stream";
const HEARTBEAT_ENDPOINT = "/api/ui-bridge/heartbeat";

// SSE reconnection delay in milliseconds
// 10s to avoid triggering Next.js route recompilation cascades in dev mode
const SSE_RECONNECT_DELAY_MS = 10000;

// Heartbeat interval — kept alive even when tab is hidden
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Get recovery suggestions based on error code
 */
function getRecoverySuggestions(errorCode: string): Array<{
  suggestion: string;
  command?: string;
  confidence: number;
  retryable: boolean;
}> {
  switch (errorCode) {
    case "ELEMENT_NOT_FOUND":
      return [
        {
          suggestion: "Wait for the page to fully load",
          command: "wait for page to load",
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: "Use a different description for the element",
          confidence: 0.8,
          retryable: false,
        },
        {
          suggestion: "Scroll the page to reveal the element",
          command: "scroll down",
          confidence: 0.6,
          retryable: true,
        },
      ];
    case "ELEMENT_NOT_VISIBLE":
      return [
        {
          suggestion: "Scroll to make the element visible",
          command: "scroll to element",
          confidence: 0.9,
          retryable: true,
        },
        {
          suggestion: "Wait for any loading overlays to disappear",
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: "Close any blocking modals or popups",
          command: "click close button",
          confidence: 0.8,
          retryable: true,
        },
      ];
    case "ELEMENT_NOT_ENABLED":
      return [
        {
          suggestion: "Fill in required fields first",
          confidence: 0.8,
          retryable: false,
        },
        {
          suggestion: "Complete prerequisite steps in the form",
          confidence: 0.7,
          retryable: false,
        },
        {
          suggestion: "Wait for the element to become enabled",
          command: "wait for element to be enabled",
          confidence: 0.6,
          retryable: true,
        },
      ];
    case "ELEMENT_NOT_INTERACTABLE":
      return [
        {
          suggestion: "Close any modal or popup blocking the element",
          command: "click close button",
          confidence: 0.9,
          retryable: true,
        },
        {
          suggestion: "Wait for animations to complete",
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: "Scroll the element into the viewport",
          command: "scroll to element",
          confidence: 0.8,
          retryable: true,
        },
      ];
    case "ACTION_TIMEOUT":
      return [
        {
          suggestion: "Increase the timeout duration",
          confidence: 0.8,
          retryable: true,
        },
        {
          suggestion: "Check if the page is responding",
          confidence: 0.7,
          retryable: false,
        },
      ];
    case "UNSUPPORTED_ACTION":
      return [
        {
          suggestion: "Use a different action type for this element",
          confidence: 0.9,
          retryable: false,
        },
        {
          suggestion: "Check the element type supports this action",
          confidence: 0.8,
          retryable: false,
        },
      ];
    default:
      return [
        {
          suggestion: "Try a different approach or check the page state",
          confidence: 0.5,
          retryable: false,
        },
      ];
  }
}

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Hook to handle UI Bridge commands from external clients
 */
export function useUIBridgeCommandHandler(enabled: boolean = true) {
  const { elements, getElement } = useUIBridge();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
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
   */
  const executeCommand = useCallback(
    async (
      action: string,
      payload: Record<string, unknown>
    ): Promise<unknown> => {
      switch (action) {
        // ========== Control Snapshot ==========
        case "getControlSnapshot": {
          return buildControlSnapshot(elements);
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
          const startTime = performance.now();
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

          // Create structured failure helper
          const createFailure = (
            errorCode: string,
            message: string,
            elementState?: unknown
          ) => ({
            success: false,
            error: message,
            failureDetails: {
              errorCode,
              message,
              elementId: id,
              selectorsTried: [`registry:${id}`],
              elementState,
              suggestedActions: getRecoverySuggestions(errorCode),
              retryRecommended: [
                "ELEMENT_NOT_VISIBLE",
                "ACTION_TIMEOUT",
              ].includes(errorCode),
              durationMs: performance.now() - startTime,
            },
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
          });

          const element = getElement(id);
          if (!element) {
            return createFailure(
              "ELEMENT_NOT_FOUND",
              `Element ${id} not found`
            );
          }

          // Get the DOM element from the bridge registry
          const domElement = (element.element ?? null) as HTMLElement | null;
          if (!domElement) {
            return createFailure(
              "ELEMENT_NOT_FOUND",
              `DOM element for ${id} not found`,
              element
            );
          }

          // Check visibility
          const isVisible =
            domElement.offsetParent !== null &&
            getComputedStyle(domElement).visibility !== "hidden" &&
            getComputedStyle(domElement).display !== "none";

          if (!isVisible) {
            return createFailure(
              "ELEMENT_NOT_VISIBLE",
              `Element ${id} exists but is not visible`,
              {
                visible: false,
                enabled: !(domElement as HTMLButtonElement).disabled,
                rect: domElement.getBoundingClientRect(),
              }
            );
          }

          // Check if enabled (for buttons/inputs)
          if ((domElement as HTMLButtonElement).disabled) {
            return createFailure(
              "ELEMENT_NOT_ENABLED",
              `Element ${id} is disabled`,
              {
                visible: true,
                enabled: false,
                rect: domElement.getBoundingClientRect(),
              }
            );
          }

          const actionType = request.action;
          try {
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
                  const proto =
                    domElement instanceof HTMLTextAreaElement
                      ? HTMLTextAreaElement.prototype
                      : HTMLInputElement.prototype;
                  const nativeSetter = Object.getOwnPropertyDescriptor(
                    proto,
                    "value"
                  )?.set;
                  const text = request.params?.text || request.text || "";
                  if (request.params?.clear || request.clear) {
                    if (nativeSetter) nativeSetter.call(domElement, "");
                    else domElement.value = "";
                    domElement.dispatchEvent(
                      new Event("input", { bubbles: true })
                    );
                  }
                  domElement.focus();
                  const current = domElement.value;
                  if (nativeSetter)
                    nativeSetter.call(domElement, current + text);
                  else domElement.value = current + text;
                  domElement.dispatchEvent(
                    new Event("input", { bubbles: true })
                  );
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot type into ${domElement.tagName} element`
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
                  domElement.dispatchEvent(
                    new Event("input", { bubbles: true })
                  );
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot clear ${domElement.tagName} element`
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
                  const setSetter = Object.getOwnPropertyDescriptor(
                    setProto,
                    "value"
                  )?.set;
                  const val =
                    request.value || (request.params?.value as string) || "";
                  if (setSetter) setSetter.call(domElement, val);
                  else domElement.value = val;
                  domElement.dispatchEvent(
                    new Event("input", { bubbles: true })
                  );
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot set value on ${domElement.tagName} element`
                  );
                }
                break;
              case "select":
                if (domElement instanceof HTMLSelectElement) {
                  domElement.value = request.value || "";
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot select on ${domElement.tagName} element`
                  );
                }
                break;
              case "check":
                if (domElement instanceof HTMLInputElement) {
                  domElement.checked = true;
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot check ${domElement.tagName} element`
                  );
                }
                break;
              case "uncheck":
                if (domElement instanceof HTMLInputElement) {
                  domElement.checked = false;
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot uncheck ${domElement.tagName} element`
                  );
                }
                break;
              default:
                return createFailure(
                  "UNSUPPORTED_ACTION",
                  `Unknown action: ${actionType}`
                );
            }
          } catch (actionError) {
            return createFailure(
              "ACTION_REJECTED",
              `Action failed: ${(actionError as Error).message}`
            );
          }

          return {
            success: true,
            action: actionType,
            elementId: id,
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
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
          searchEngine.updateElements(elements);
          // Default to fuzzy matching for AI search
          const searchCriteria = {
            fuzzy: true,
            ...(payload as Parameters<typeof searchEngine.search>[0]),
          };
          const searchResponse = searchEngine.search(searchCriteria);
          return {
            results: searchResponse.results,
            total: searchResponse.results.length,
            scannedCount: searchResponse.scannedCount,
            _debug_handler: "SSE_v2",
            _debug_elementCount: elements.length,
            timestamp: Date.now(),
          };
        }

        case "aiExecute": {
          const startTime = performance.now();
          // Parse natural language and execute
          const { parseNLInstruction } = await import("@qontinui/ui-bridge/ai");
          const { instruction, confidenceThreshold = 0.7 } = payload as {
            instruction: string;
            confidenceThreshold?: number;
          };

          // Create structured failure helper for AI execution
          const createAIFailure = (
            errorCode: string,
            message: string,
            options: {
              elementId?: string;
              searchResults?: Array<{
                element: { id: string; description: string; type: string };
                confidence: number;
              }>;
            } = {}
          ) => ({
            success: false,
            executedAction: instruction,
            error: message,
            errorCode,
            failureInfo: {
              errorCode,
              message,
              elementId: options.elementId,
              partialMatches: options.searchResults?.slice(1, 4).map((r) => ({
                elementId: r.element.id,
                confidence: r.confidence,
                reason: "Lower confidence match",
                type: r.element.type,
                description: r.element.description,
              })),
              suggestedActions: getRecoverySuggestions(errorCode),
              retryRecommended: [
                "LOW_CONFIDENCE",
                "ELEMENT_NOT_VISIBLE",
                "ACTION_TIMEOUT",
              ].includes(errorCode),
              durationMs: performance.now() - startTime,
            },
            confidence: options.searchResults?.[0]?.confidence || 0,
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
          });

          const parsed = parseNLInstruction(instruction);

          if (!parsed) {
            return createAIFailure(
              "PARSE_ERROR",
              `Could not parse instruction: "${instruction}"`
            );
          }

          // Find the target element
          const { createSearchEngine } = await import("@qontinui/ui-bridge/ai");
          // elements is available from hook scope
          const searchEngine = createSearchEngine({ includeHidden: true });
          searchEngine.updateElements(elements);

          const searchResponse = searchEngine.search({
            text: parsed.targetDescription,
            fuzzy: true,
          });
          const searchResults = searchResponse.results;

          if (searchResults.length === 0) {
            return createAIFailure(
              "ELEMENT_NOT_FOUND",
              `No element found matching: "${parsed.targetDescription}"`
            );
          }

          // Check confidence threshold
          const firstResult = searchResults[0];
          if (!firstResult || firstResult.confidence < confidenceThreshold) {
            return createAIFailure(
              "LOW_CONFIDENCE",
              `Best match confidence (${firstResult ? (firstResult.confidence * 100).toFixed(0) : 0}%) is below threshold (${(confidenceThreshold * 100).toFixed(0)}%)`,
              {
                searchResults: searchResults.map((r) => ({
                  element: {
                    id: r.element.id,
                    description: r.element.description,
                    type: r.element.type,
                  },
                  confidence: r.confidence,
                })),
              }
            );
          }

          const targetElement = firstResult.element;
          const domElement = (getElement(targetElement.id)?.element ??
            null) as HTMLElement | null;

          if (!domElement) {
            return createAIFailure(
              "ELEMENT_NOT_FOUND",
              `DOM element not found for ${targetElement.id}`,
              {
                elementId: targetElement.id,
                searchResults: searchResults.map((r) => ({
                  element: {
                    id: r.element.id,
                    description: r.element.description,
                    type: r.element.type,
                  },
                  confidence: r.confidence,
                })),
              }
            );
          }

          // Check visibility and enabled state
          const isVisible =
            domElement.offsetParent !== null &&
            getComputedStyle(domElement).visibility !== "hidden";

          if (!isVisible) {
            return createAIFailure(
              "ELEMENT_NOT_VISIBLE",
              `Element "${targetElement.id}" exists but is not visible`,
              {
                elementId: targetElement.id,
                searchResults: searchResults.map((r) => ({
                  element: {
                    id: r.element.id,
                    description: r.element.description,
                    type: r.element.type,
                  },
                  confidence: r.confidence,
                })),
              }
            );
          }

          if ((domElement as HTMLButtonElement).disabled) {
            return createAIFailure(
              "ELEMENT_NOT_ENABLED",
              `Element "${targetElement.id}" is disabled`,
              {
                elementId: targetElement.id,
                searchResults: searchResults.map((r) => ({
                  element: {
                    id: r.element.id,
                    description: r.element.description,
                    type: r.element.type,
                  },
                  confidence: r.confidence,
                })),
              }
            );
          }

          // Execute the action
          try {
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
                  domElement.dispatchEvent(
                    new Event("input", { bubbles: true })
                  );
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createAIFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot type into ${domElement.tagName} element`,
                    { elementId: targetElement.id }
                  );
                }
                break;
              case "select":
                if (domElement instanceof HTMLSelectElement) {
                  domElement.value = parsed.value || "";
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createAIFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot select on ${domElement.tagName} element`,
                    { elementId: targetElement.id }
                  );
                }
                break;
              case "check":
                if (domElement instanceof HTMLInputElement) {
                  domElement.checked = true;
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createAIFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot check ${domElement.tagName} element`,
                    { elementId: targetElement.id }
                  );
                }
                break;
              case "uncheck":
                if (domElement instanceof HTMLInputElement) {
                  domElement.checked = false;
                  domElement.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                } else {
                  return createAIFailure(
                    "UNSUPPORTED_ACTION",
                    `Cannot uncheck ${domElement.tagName} element`,
                    { elementId: targetElement.id }
                  );
                }
                break;
              default:
                return createAIFailure(
                  "UNSUPPORTED_ACTION",
                  `Unsupported action: ${parsed.action}`,
                  { elementId: targetElement.id }
                );
            }
          } catch (actionError) {
            return createAIFailure(
              "ACTION_REJECTED",
              `Action failed: ${(actionError as Error).message}`,
              { elementId: targetElement.id }
            );
          }

          return {
            success: true,
            executedAction: `${parsed.action} on ${targetElement.id}`,
            elementUsed: targetElement,
            confidence: firstResult.confidence,
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
          };
        }

        case "aiAssert": {
          const { createAssertionExecutor } =
            await import("@qontinui/ui-bridge/ai");
          type AssertionType = import("@qontinui/ui-bridge/ai").AssertionType;
          // elements is available from hook scope
          const executor = createAssertionExecutor({});
          // Cast RegisteredElement[] to the expected type - both share the same core structure
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
          const { createAssertionExecutor } =
            await import("@qontinui/ui-bridge/ai");
          type AssertionType = import("@qontinui/ui-bridge/ai").AssertionType;
          // elements is available from hook scope
          const executor = createAssertionExecutor({});
          // Cast RegisteredElement[] to the expected type - both share the same core structure
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
          const { createSnapshotManager } =
            await import("@qontinui/ui-bridge/ai");
          // elements is available from hook scope
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
          // Semantic diff requires previous snapshot tracking - not implemented
          // payload expected: { since?: number }
          return null;
        }

        case "getPageSummary": {
          const { generatePageSummary } =
            await import("@qontinui/ui-bridge/ai");
          // elements is available from hook scope
          // Convert RegisteredElement[] to minimal AIDiscoveredElement-like objects for the summary
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
          // Return empty for now - could be tracked
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
          // Build a tree representation
          // elements is available from hook scope
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

        // ========== Component State ==========
        case "getComponentState": {
          // payload expected: { id: string }
          // Components are not fully implemented in this handler yet
          // Return empty state as placeholder
          return {
            state: {},
            computed: {},
            timestamp: Date.now(),
          };
        }

        // ========== Semantic Search ==========
        case "aiSemanticSearch": {
          // Semantic search requires embedding support
          // For now, fall back to text-based search
          const criteria = payload as {
            query: string;
            threshold?: number;
            limit?: number;
          };
          const { createSearchEngine } = await import("@qontinui/ui-bridge/ai");
          const searchEngine = createSearchEngine({});
          searchEngine.updateElements(elements);
          const searchResponse = searchEngine.search({
            text: criteria.query,
            fuzzy: true,
            fuzzyThreshold: criteria.threshold ?? 0.5,
          });
          const allResults = searchResponse.results;
          const limitedResults = criteria.limit
            ? allResults.slice(0, criteria.limit)
            : allResults;
          return {
            results: limitedResults.map(
              (
                r: {
                  element: { description?: string; id: string };
                  confidence: number;
                },
                idx: number
              ) => ({
                element: r.element,
                similarity: r.confidence,
                rank: idx + 1,
                embeddedText: r.element.description || r.element.id,
              })
            ),
            bestMatch:
              limitedResults.length > 0
                ? {
                    element: limitedResults[0]!.element,
                    similarity: limitedResults[0]!.confidence,
                    rank: 1,
                    embeddedText:
                      limitedResults[0]!.element.description ||
                      limitedResults[0]!.element.id,
                  }
                : null,
            scannedCount: elements.length,
            durationMs: searchResponse.durationMs,
            query: criteria.query,
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
   * Send a command response back to the server
   */
  const sendResponse = useCallback(
    async (commandId: string, success: boolean, result: unknown) => {
      try {
        await fetch(COMMANDS_RESPONSE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId,
            success,
            result,
            error: success ? undefined : (result as { error?: string })?.error,
          }),
        });
      } catch (e) {
        console.error("[UIBridge] Failed to send command response:", e);
      }
    },
    []
  );

  /**
   * Process a single command
   */
  const processCommand = useCallback(
    async (command: QueuedCommand) => {
      try {
        const result = await executeCommand(
          command.action,
          command.payload as Record<string, unknown>
        );

        // Check if result contains a failure (structured error)
        const resultObj = result as {
          success?: boolean;
          failureDetails?: unknown;
        };
        if (resultObj && resultObj.success === false) {
          await sendResponse(command.commandId, false, result);
          return;
        }

        await sendResponse(command.commandId, true, result);
      } catch (e: unknown) {
        const errorMessage = (e as Error).message;
        let errorCode = "UNKNOWN_ERROR";

        if (errorMessage.includes("not found")) {
          errorCode = "ELEMENT_NOT_FOUND";
        } else if (errorMessage.includes("timeout")) {
          errorCode = "ACTION_TIMEOUT";
        } else if (
          errorMessage.includes("parse") ||
          errorMessage.includes("Could not parse")
        ) {
          errorCode = "PARSE_ERROR";
        }

        await sendResponse(command.commandId, false, {
          success: false,
          error: errorMessage,
          failureDetails: {
            errorCode,
            message: errorMessage,
            suggestedActions: getRecoverySuggestions(errorCode),
            retryRecommended: [
              "ACTION_TIMEOUT",
              "ELEMENT_NOT_VISIBLE",
            ].includes(errorCode),
            timestamp: Date.now(),
          },
          durationMs: 0,
          timestamp: Date.now(),
        });
      }
    },
    [executeCommand, sendResponse]
  );

  /**
   * Connect to the SSE command stream
   */
  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;

      const es = new EventSource(COMMANDS_STREAM_ENDPOINT);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Skip the initial connection event
          if (data.type === "connected") {
            console.debug("[UIBridge] SSE stream connected");
            return;
          }

          // Process the command
          if (data.commandId && data.action) {
            processCommand(data as QueuedCommand);
          }
        } catch (e) {
          console.error("[UIBridge] Failed to parse SSE message:", e);
        }
      };

      es.onerror = () => {
        // EventSource automatically reconnects, but we add a delay
        // to avoid hammering the server
        es.close();
        eventSourceRef.current = null;

        if (isMounted && document.visibilityState === "visible") {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) {
              console.debug("[UIBridge] Reconnecting SSE stream...");
              connect();
            }
          }, SSE_RECONNECT_DELAY_MS);
        }
      };
    };

    // Only connect when tab is visible
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!eventSourceRef.current) {
          connect();
        }
      } else {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      }
    };

    if (document.visibilityState === "visible") {
      connect();
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isMounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, processCommand]);

  // Heartbeat: POST every 10s to signal the app is responsive.
  // Kept alive even when the tab is hidden (unlike the SSE stream).
  useEffect(() => {
    if (!enabled) return;

    const sendHeartbeat = () => {
      fetch(HEARTBEAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: Date.now() }),
      }).catch(() => {
        // Heartbeat failure is non-fatal — server will detect staleness
      });
    };

    // Send initial heartbeat immediately
    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [enabled]);

  return {
    isEnabled: enabled,
  };
}
