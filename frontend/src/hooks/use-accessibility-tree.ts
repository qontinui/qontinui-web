"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import type {
  AccessibilitySnapshot,
  AccessibilityNode,
  AccessibilitySelector,
} from "@qontinui/schemas/accessibility";

interface UseAccessibilityTreeOptions {
  /** Runner API base URL */
  apiUrl?: string;
  /** CDP host for browser connection */
  cdpHost?: string;
  /** CDP port for browser connection */
  cdpPort?: number;
  /** Auto-capture on mount */
  autoCapture?: boolean;
}

interface UseAccessibilityTreeResult {
  /** Current accessibility snapshot */
  snapshot: AccessibilitySnapshot | null;
  /** Currently selected node */
  selectedNode: AccessibilityNode | null;
  /** Currently selected ref */
  selectedRef: string | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** AI-friendly context string */
  aiContext: string | null;
  /** Capture accessibility tree */
  capture: (options?: CaptureOptions) => Promise<void>;
  /** Select a node by ref */
  selectNode: (node: AccessibilityNode) => void;
  /** Click an element by ref */
  clickRef: (ref: string) => Promise<boolean>;
  /** Type into an element by ref */
  fillRef: (ref: string, value: string, clearFirst?: boolean) => Promise<boolean>;
  /** Focus an element by ref */
  focusRef: (ref: string) => Promise<boolean>;
  /** Find elements matching selector */
  findElements: (selector: AccessibilitySelector) => Promise<AccessibilityNode[]>;
  /** Get node by ref from current snapshot */
  getNodeByRef: (ref: string) => AccessibilityNode | null;
  /** Disconnect from accessibility source */
  disconnect: () => Promise<void>;
}

interface CaptureOptions {
  target?: string;
  interactiveOnly?: boolean;
  includeHidden?: boolean;
  maxDepth?: number;
}

/**
 * Hook for interacting with accessibility tree capture and ref-based actions.
 *
 * This hook provides a complete interface for:
 * - Capturing accessibility trees from browsers via CDP
 * - Selecting and inspecting elements
 * - Performing ref-based actions (click, fill, focus)
 * - Getting AI-friendly context for prompts
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const {
 *     snapshot,
 *     selectedNode,
 *     isLoading,
 *     capture,
 *     clickRef,
 *     aiContext,
 *   } = useAccessibilityTree({ cdpPort: 9222 });
 *
 *   return (
 *     <div>
 *       <button onClick={() => capture()}>Capture Tree</button>
 *       {snapshot && <AccessibilityTreeViewer snapshot={snapshot} ... />}
 *       <button onClick={() => clickRef("@e3")}>Click @e3</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAccessibilityTree(
  options: UseAccessibilityTreeOptions = {}
): UseAccessibilityTreeResult {
  const { apiUrl = "http://localhost:9876", cdpHost = "localhost", cdpPort = 9222 } = options;

  const [snapshot, setSnapshot] = useState<AccessibilitySnapshot | null>(null);
  const [selectedNode, setSelectedNode] = useState<AccessibilityNode | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiContext, setAiContext] = useState<string | null>(null);

  // Helper to send commands to the runner
  const sendCommand = useCallback(
    async <T>(command: string, params: Record<string, unknown> = {}): Promise<T> => {
      const response = await fetch(`${apiUrl}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "command",
          command,
          params,
        }),
      });

      if (!response.ok) {
        throw new Error(`Command failed: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error ?? "Command failed");
      }

      return result as T;
    },
    [apiUrl]
  );

  // Capture accessibility tree
  const capture = useCallback(
    async (captureOptions: CaptureOptions = {}) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await sendCommand<{
          success: boolean;
          snapshot?: Record<string, unknown>;
          ai_context?: string;
          error?: string;
        }>("capture_accessibility", {
          target: captureOptions.target ?? "auto",
          cdp_host: cdpHost,
          cdp_port: cdpPort,
          interactive_only: captureOptions.interactiveOnly ?? false,
          include_hidden: captureOptions.includeHidden ?? false,
          max_depth: captureOptions.maxDepth,
        });

        if (result.snapshot) {
          setSnapshot(result.snapshot as unknown as AccessibilitySnapshot);
        }
        if (result.ai_context) {
          setAiContext(result.ai_context);
        }

        toast.success("Accessibility tree captured");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to capture tree";
        setError(message);
        toast.error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [sendCommand, cdpHost, cdpPort]
  );

  // Select a node
  const selectNode = useCallback((node: AccessibilityNode) => {
    setSelectedNode(node);
    setSelectedRef(node.ref);
  }, []);

  // Click element by ref
  const clickRef = useCallback(
    async (ref: string): Promise<boolean> => {
      try {
        const result = await sendCommand<{ success: boolean; error?: string }>("click_ref", {
          ref,
        });
        if (result.success) {
          toast.success(`Clicked ${ref}`);
        } else {
          toast.error(result.error ?? `Failed to click ${ref}`);
        }
        return result.success;
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to click ${ref}`;
        toast.error(message);
        return false;
      }
    },
    [sendCommand]
  );

  // Fill element by ref
  const fillRef = useCallback(
    async (ref: string, value: string, clearFirst = false): Promise<boolean> => {
      try {
        const result = await sendCommand<{ success: boolean; error?: string }>("fill_ref", {
          ref,
          value,
          clear_first: clearFirst,
        });
        if (result.success) {
          toast.success(`Filled ${ref}`);
        } else {
          toast.error(result.error ?? `Failed to fill ${ref}`);
        }
        return result.success;
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to fill ${ref}`;
        toast.error(message);
        return false;
      }
    },
    [sendCommand]
  );

  // Focus element by ref
  const focusRef = useCallback(
    async (ref: string): Promise<boolean> => {
      try {
        const result = await sendCommand<{ success: boolean; error?: string }>("focus_ref", {
          ref,
        });
        if (result.success) {
          toast.success(`Focused ${ref}`);
        } else {
          toast.error(result.error ?? `Failed to focus ${ref}`);
        }
        return result.success;
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to focus ${ref}`;
        toast.error(message);
        return false;
      }
    },
    [sendCommand]
  );

  // Find elements matching selector
  const findElements = useCallback(
    async (selector: AccessibilitySelector): Promise<AccessibilityNode[]> => {
      try {
        const result = await sendCommand<{
          success: boolean;
          elements?: Record<string, unknown>[];
          error?: string;
        }>("find_accessibility_elements", selector as unknown as Record<string, unknown>);
        return (result.elements ?? []) as unknown as AccessibilityNode[];
      } catch (err) {
        console.error("Failed to find elements:", err);
        return [];
      }
    },
    [sendCommand]
  );

  // Get node by ref from current snapshot
  const getNodeByRef = useCallback(
    (ref: string): AccessibilityNode | null => {
      if (!snapshot?.root) return null;

      const findNode = (node: AccessibilityNode): AccessibilityNode | null => {
        if (node.ref === ref) return node;
        for (const child of node.children ?? []) {
          const found = findNode(child);
          if (found) return found;
        }
        return null;
      };

      return findNode(snapshot.root);
    },
    [snapshot?.root]
  );

  // Disconnect from accessibility source
  const disconnect = useCallback(async () => {
    try {
      await sendCommand("disconnect_accessibility");
      setSnapshot(null);
      setSelectedNode(null);
      setSelectedRef(null);
      setAiContext(null);
      toast.info("Disconnected from accessibility source");
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
  }, [sendCommand]);

  return {
    snapshot,
    selectedNode,
    selectedRef,
    isLoading,
    error,
    aiContext,
    capture,
    selectNode,
    clickRef,
    fillRef,
    focusRef,
    findElements,
    getNodeByRef,
    disconnect,
  };
}
