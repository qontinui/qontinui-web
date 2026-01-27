"use client";

/**
 * UI Bridge Command Handler Hook
 *
 * This hook polls the server for pending commands and executes them
 * using the UIBridgeRegistry in the browser context.
 *
 * Usage:
 * Place this hook in a component that wraps your app (like the root layout)
 * to enable remote automation of the UI.
 */

import { useEffect, useRef, useCallback } from "react";
import { useUIBridge } from "ui-bridge/react";
import type { ControlSnapshot } from "ui-bridge/control";

// Command polling interval in milliseconds
const POLL_INTERVAL_MS = 500;

// API endpoints
const COMMANDS_ENDPOINT = "/api/ui-bridge/commands";

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

/**
 * Hook to handle UI Bridge commands from external clients
 */
export function useUIBridgeCommandHandler(enabled: boolean = true) {
  const { registry, controller } = useUIBridge();
  const isPollingRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
          const snapshot: ControlSnapshot = {
            timestamp: Date.now(),
            elements: registry.getElements().map((e) => ({
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
          const element = registry.getElementById(id as string);
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
          const element = registry.getElementById(id);
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
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            case "select":
              if (domElement instanceof HTMLSelectElement) {
                domElement.value = request.value || "";
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            case "check":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = true;
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            case "uncheck":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = false;
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
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
          const elements = registry.getElements();
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
          const elements = registry.getElements();
          const searchEngine = createSearchEngine({}, elements);
          const results = searchEngine.search(
            payload as Parameters<typeof searchEngine.search>[0]
          );
          return {
            results,
            total: results.length,
            timestamp: Date.now(),
          };
        }

        case "aiExecute": {
          // Parse natural language and execute
          const { parseNLInstruction, createNLActionExecutor } = await import(
            "ui-bridge/ai"
          );
          const { instruction } = payload as { instruction: string };
          const parsed = parseNLInstruction(instruction);

          if (!parsed) {
            throw new Error(`Could not parse instruction: ${instruction}`);
          }

          // Find the target element
          const { createSearchEngine } = await import("ui-bridge/ai");
          const elements = registry.getElements();
          const searchEngine = createSearchEngine({}, elements);

          const searchResults = searchEngine.search({
            text: parsed.targetDescription,
            fuzzy: true,
          });

          if (searchResults.length === 0) {
            throw new Error(
              `No element found matching: ${parsed.targetDescription}`
            );
          }

          const targetElement = searchResults[0].element;
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
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            case "select":
              if (domElement instanceof HTMLSelectElement) {
                domElement.value = parsed.value || "";
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            case "check":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = true;
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            case "uncheck":
              if (domElement instanceof HTMLInputElement) {
                domElement.checked = false;
                domElement.dispatchEvent(new Event("change", { bubbles: true }));
              }
              break;
            default:
              throw new Error(`Unsupported action: ${parsed.action}`);
          }

          return {
            success: true,
            executedAction: `${parsed.action} on ${targetElement.id}`,
            elementUsed: targetElement,
            confidence: searchResults[0].confidence,
          };
        }

        case "aiAssert": {
          const { createAssertionExecutor } = await import("ui-bridge/ai");
          const elements = registry.getElements();
          const executor = createAssertionExecutor({}, elements, (id) => {
            const el = document.querySelector(
              `[data-ui-id="${id}"]`
            ) as HTMLElement | null;
            if (!el) return null;
            return {
              isVisible:
                el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden",
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
          const elements = registry.getElements();
          const executor = createAssertionExecutor({}, elements, (id) => {
            const el = document.querySelector(
              `[data-ui-id="${id}"]`
            ) as HTMLElement | null;
            if (!el) return null;
            return {
              isVisible:
                el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden",
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
          const elements = registry.getElements();
          const manager = createSnapshotManager({}, elements);
          return manager.capture();
        }

        case "getSemanticDiff": {
          const { createDiffManager } = await import("ui-bridge/ai");
          const elements = registry.getElements();
          const manager = createDiffManager({}, elements);
          const { since } = payload as { since?: number };
          // This would need previous snapshot tracking - for now return null
          return null;
        }

        case "getPageSummary": {
          const { generatePageSummary } = await import("ui-bridge/ai");
          const elements = registry.getElements();
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
          const elements = registry.getElements();
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
    [registry, controller]
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

        // Send success response
        await fetch(COMMANDS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: command.commandId,
            success: true,
            result,
          }),
        });
      } catch (e) {
        // Send error response
        await fetch(COMMANDS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: command.commandId,
            success: false,
            error: (e as Error).message,
          }),
        });
      }
    },
    [executeCommand]
  );

  /**
   * Poll for and process commands
   */
  const pollCommands = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const response = await fetch(COMMANDS_ENDPOINT);
      if (!response.ok) {
        console.error(
          "[UIBridge] Failed to poll commands:",
          response.statusText
        );
        return;
      }

      const data: CommandsResponse = await response.json();
      if (data.commands && data.commands.length > 0) {
        // Process all commands concurrently
        await Promise.all(data.commands.map(processCommand));
      }
    } catch (e) {
      console.error("[UIBridge] Error polling commands:", e);
    } finally {
      isPollingRef.current = false;
    }
  }, [processCommand]);

  /**
   * Start/stop polling based on enabled state
   */
  useEffect(() => {
    if (!enabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Start polling
    pollIntervalRef.current = setInterval(pollCommands, POLL_INTERVAL_MS);

    // Initial poll
    pollCommands();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, pollCommands]);

  return {
    isEnabled: enabled,
    pollInterval: POLL_INTERVAL_MS,
  };
}
