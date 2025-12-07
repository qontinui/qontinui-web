/**
 * Canvas Keyboard Shortcuts Hook
 *
 * Provides keyboard shortcut handling for canvas operations:
 * - Ctrl/Cmd + Z: Undo
 * - Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y: Redo
 * - Ctrl/Cmd + C: Copy
 * - Ctrl/Cmd + V: Paste
 * - Ctrl/Cmd + X: Cut
 * - Ctrl/Cmd + D: Duplicate
 * - Ctrl/Cmd + A: Select all
 * - Delete/Backspace: Delete selected
 * - Ctrl/Cmd + F: Find/search
 * - Space: Pan mode
 * - Escape: Clear selection / Cancel operation
 * - Arrow keys: Move selection
 * - +/-: Zoom in/out
 */

import { useEffect, useCallback, useRef } from "react";
import { useCanvasStore } from "../stores/canvas-store";

// ============================================================================
// Types
// ============================================================================

export interface KeyboardShortcutConfig {
  /** Enable keyboard shortcuts */
  enabled?: boolean;

  /** Enable undo/redo shortcuts */
  enableUndo?: boolean;

  /** Enable clipboard shortcuts */
  enableClipboard?: boolean;

  /** Enable selection shortcuts */
  enableSelection?: boolean;

  /** Enable deletion shortcuts */
  enableDeletion?: boolean;

  /** Enable zoom shortcuts */
  enableZoom?: boolean;

  /** Enable pan mode shortcut (space) */
  enablePan?: boolean;

  /** Enable move shortcuts (arrow keys) */
  enableMove?: boolean;

  /** Custom key handlers */
  customHandlers?: Record<string, (event: KeyboardEvent) => void>;

  /** Prevent default for handled keys */
  preventDefault?: boolean;

  /** Stop propagation for handled keys */
  stopPropagation?: boolean;
}

interface ShortcutHandler {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: (event: KeyboardEvent) => void;
  description: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if event matches shortcut definition
 */
function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Omit<ShortcutHandler, "handler" | "description">
): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false;
  }

  if (shortcut.ctrl !== undefined && event.ctrlKey !== shortcut.ctrl) {
    return false;
  }

  if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) {
    return false;
  }

  if (shortcut.alt !== undefined && event.altKey !== shortcut.alt) {
    return false;
  }

  if (shortcut.meta !== undefined && event.metaKey !== shortcut.meta) {
    return false;
  }

  return true;
}

/**
 * Check if event target is an input element
 */
function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

/**
 * Get modifier key name based on platform
 */
function getModifierKey(): "ctrl" | "meta" {
  return typeof navigator !== "undefined" && navigator.platform.includes("Mac")
    ? "meta"
    : "ctrl";
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for canvas keyboard shortcuts
 */
export function useCanvasKeyboard(config: KeyboardShortcutConfig = {}) {
  const {
    enabled = true,
    enableUndo = true,
    enableClipboard = true,
    enableSelection = true,
    enableDeletion = true,
    enableZoom = true,
    enablePan = true,
    enableMove = true,
    customHandlers = {},
    preventDefault = true,
    stopPropagation = true,
  } = config;

  const modifierKey = getModifierKey();
  const isPanningRef = useRef(false);

  // Get store actions
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const copy = useCanvasStore((state) => state.copy);
  const paste = useCanvasStore((state) => state.paste);
  const cut = useCanvasStore((state) => state.cut);
  const duplicate = useCanvasStore((state) => state.duplicate);
  const selectAll = useCanvasStore((state) => state.selectAll);
  const deleteActions = useCanvasStore((state) => state.deleteActions);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const zoomIn = useCanvasStore((state) => state.zoomIn);
  const zoomOut = useCanvasStore((state) => state.zoomOut);
  const setPanning = useCanvasStore((state) => state.setPanning);
  const selectedNodes = useCanvasStore((state) => state.selectedNodes);
  const moveActions = useCanvasStore((state) => state.moveActions);
  const getActionById = useCanvasStore((state) => state.getActionById);
  const cancelConnecting = useCanvasStore((state) => state.cancelConnecting);
  const isConnecting = useCanvasStore((state) => state.isConnecting);

  // Build shortcuts list
  const shortcuts = useRef<ShortcutHandler[]>([]);

  useEffect(() => {
    const newShortcuts: ShortcutHandler[] = [];

    // Undo/Redo
    if (enableUndo) {
      newShortcuts.push({
        key: "z",
        [modifierKey]: true,
        handler: () => undo(),
        description: "Undo",
      });

      newShortcuts.push({
        key: "z",
        [modifierKey]: true,
        shift: true,
        handler: () => redo(),
        description: "Redo",
      });

      newShortcuts.push({
        key: "y",
        [modifierKey]: true,
        handler: () => redo(),
        description: "Redo",
      });
    }

    // Clipboard
    if (enableClipboard) {
      newShortcuts.push({
        key: "c",
        [modifierKey]: true,
        handler: () => copy(),
        description: "Copy",
      });

      newShortcuts.push({
        key: "v",
        [modifierKey]: true,
        handler: () => paste(),
        description: "Paste",
      });

      newShortcuts.push({
        key: "x",
        [modifierKey]: true,
        handler: () => cut(),
        description: "Cut",
      });

      newShortcuts.push({
        key: "d",
        [modifierKey]: true,
        handler: () => duplicate(),
        description: "Duplicate",
      });
    }

    // Selection
    if (enableSelection) {
      newShortcuts.push({
        key: "a",
        [modifierKey]: true,
        handler: () => selectAll(),
        description: "Select all",
      });

      newShortcuts.push({
        key: "escape",
        handler: () => {
          if (isConnecting) {
            cancelConnecting();
          } else {
            clearSelection();
          }
        },
        description: "Clear selection / Cancel",
      });
    }

    // Deletion
    if (enableDeletion) {
      newShortcuts.push({
        key: "delete",
        handler: () => {
          if (selectedNodes.length > 0) {
            deleteActions(selectedNodes);
          }
        },
        description: "Delete selected",
      });

      newShortcuts.push({
        key: "backspace",
        handler: () => {
          if (selectedNodes.length > 0) {
            deleteActions(selectedNodes);
          }
        },
        description: "Delete selected",
      });
    }

    // Zoom
    if (enableZoom) {
      newShortcuts.push({
        key: "=",
        [modifierKey]: true,
        handler: () => zoomIn(),
        description: "Zoom in",
      });

      newShortcuts.push({
        key: "+",
        [modifierKey]: true,
        handler: () => zoomIn(),
        description: "Zoom in",
      });

      newShortcuts.push({
        key: "-",
        [modifierKey]: true,
        handler: () => zoomOut(),
        description: "Zoom out",
      });
    }

    // Move (arrow keys)
    if (enableMove) {
      const moveDistance = 10;

      newShortcuts.push({
        key: "arrowup",
        handler: () => {
          if (selectedNodes.length > 0) {
            const updates = selectedNodes
              .map((nodeId) => {
                const action = getActionById(nodeId);
                if (!action) return null;
                return {
                  actionId: nodeId,
                  position: [
                    action.position[0],
                    action.position[1] - moveDistance,
                  ] as [number, number],
                };
              })
              .filter(Boolean) as Array<{
              actionId: string;
              position: [number, number];
            }>;
            moveActions(updates);
          }
        },
        description: "Move up",
      });

      newShortcuts.push({
        key: "arrowdown",
        handler: () => {
          if (selectedNodes.length > 0) {
            const updates = selectedNodes
              .map((nodeId) => {
                const action = getActionById(nodeId);
                if (!action) return null;
                return {
                  actionId: nodeId,
                  position: [
                    action.position[0],
                    action.position[1] + moveDistance,
                  ] as [number, number],
                };
              })
              .filter(Boolean) as Array<{
              actionId: string;
              position: [number, number];
            }>;
            moveActions(updates);
          }
        },
        description: "Move down",
      });

      newShortcuts.push({
        key: "arrowleft",
        handler: () => {
          if (selectedNodes.length > 0) {
            const updates = selectedNodes
              .map((nodeId) => {
                const action = getActionById(nodeId);
                if (!action) return null;
                return {
                  actionId: nodeId,
                  position: [
                    action.position[0] - moveDistance,
                    action.position[1],
                  ] as [number, number],
                };
              })
              .filter(Boolean) as Array<{
              actionId: string;
              position: [number, number];
            }>;
            moveActions(updates);
          }
        },
        description: "Move left",
      });

      newShortcuts.push({
        key: "arrowright",
        handler: () => {
          if (selectedNodes.length > 0) {
            const updates = selectedNodes
              .map((nodeId) => {
                const action = getActionById(nodeId);
                if (!action) return null;
                return {
                  actionId: nodeId,
                  position: [
                    action.position[0] + moveDistance,
                    action.position[1],
                  ] as [number, number],
                };
              })
              .filter(Boolean) as Array<{
              actionId: string;
              position: [number, number];
            }>;
            moveActions(updates);
          }
        },
        description: "Move right",
      });
    }

    shortcuts.current = newShortcuts;
  }, [
    enableUndo,
    enableClipboard,
    enableSelection,
    enableDeletion,
    enableZoom,
    enableMove,
    modifierKey,
    undo,
    redo,
    copy,
    paste,
    cut,
    duplicate,
    selectAll,
    deleteActions,
    clearSelection,
    zoomIn,
    zoomOut,
    selectedNodes,
    moveActions,
    getActionById,
    cancelConnecting,
    isConnecting,
  ]);

  // Keyboard event handler
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Skip if typing in input field
      if (isInputElement(event.target)) {
        return;
      }

      // Check custom handlers first
      const customKey = event.key.toLowerCase();
      if (customHandlers[customKey]) {
        customHandlers[customKey](event);
        if (preventDefault) event.preventDefault();
        if (stopPropagation) event.stopPropagation();
        return;
      }

      // Check built-in shortcuts
      for (const shortcut of shortcuts.current) {
        if (matchesShortcut(event, shortcut)) {
          shortcut.handler(event);
          if (preventDefault) event.preventDefault();
          if (stopPropagation) event.stopPropagation();
          return;
        }
      }
    },
    [enabled, customHandlers, preventDefault, stopPropagation]
  );

  // Pan mode with space key
  const handlePanKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !enablePan) return;
      if (isInputElement(event.target)) return;

      if (event.key === " " && !isPanningRef.current) {
        isPanningRef.current = true;
        setPanning(true);
        if (preventDefault) event.preventDefault();
      }
    },
    [enabled, enablePan, setPanning, preventDefault]
  );

  const handlePanKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !enablePan) return;

      if (event.key === " " && isPanningRef.current) {
        isPanningRef.current = false;
        setPanning(false);
      }
    },
    [enabled, enablePan, setPanning]
  );

  // Attach event listeners
  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keydown", handlePanKeyDown);
    window.addEventListener("keyup", handlePanKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keydown", handlePanKeyDown);
      window.removeEventListener("keyup", handlePanKeyUp);
    };
  }, [enabled, handleKeyDown, handlePanKeyDown, handlePanKeyUp]);

  // Get list of active shortcuts for documentation
  const getShortcuts = useCallback(() => {
    return shortcuts.current.map((s) => ({
      key: s.key,
      ctrl: s.ctrl,
      shift: s.shift,
      alt: s.alt,
      meta: s.meta,
      description: s.description,
    }));
  }, []);

  return {
    getShortcuts,
    modifierKey,
  };
}

// ============================================================================
// Shortcut Helper Hook
// ============================================================================

/**
 * Hook to register a single custom keyboard shortcut
 */
export function useKeyboardShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
    enabled?: boolean;
    preventDefault?: boolean;
  } = {}
) {
  const { enabled = true, preventDefault = true, ...modifiers } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInputElement(event.target)) return;

      if (matchesShortcut(event, { key, ...modifiers })) {
        handler(event);
        if (preventDefault) event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [key, handler, enabled, preventDefault, modifiers]);
}
