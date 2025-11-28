/**
 * Canvas Gestures Hook - Handle mouse and keyboard gestures
 *
 * Gestures:
 * - Space + Drag: Pan mode
 * - Ctrl + Scroll: Zoom
 * - Middle Mouse Drag: Pan
 * - Double Click Node: Edit properties
 * - Double Click Canvas: Add node at position
 * - Alt + Drag: Duplicate node
 * - Shift + Drag: Constrain to axis
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";

// ============================================================================
// Types
// ============================================================================

export interface GestureState {
  isPanning: boolean;
  isSpaceHeld: boolean;
  isAltHeld: boolean;
  isShiftHeld: boolean;
  isCtrlHeld: boolean;
  dragStart: { x: number; y: number } | null;
  dragCurrent: { x: number; y: number } | null;
}

export interface CanvasGesturesConfig {
  enablePanOnSpace?: boolean;
  enableZoomOnCtrlScroll?: boolean;
  enableMiddleMousePan?: boolean;
  enableDoubleClickNode?: boolean;
  enableDoubleClickCanvas?: boolean;
  enableAltDuplicate?: boolean;
  enableShiftConstrain?: boolean;
  onDoubleClickNode?: (nodeId: string) => void;
  onDoubleClickCanvas?: (position: { x: number; y: number }) => void;
  onNodeDuplicate?: (
    nodeId: string,
    position: { x: number; y: number }
  ) => void;
}

// ============================================================================
// Canvas Gestures Hook
// ============================================================================

export function useCanvasGestures(config: CanvasGesturesConfig = {}) {
  const {
    enablePanOnSpace = true,
    enableZoomOnCtrlScroll = true,
    enableMiddleMousePan = true,
    enableDoubleClickNode = true,
    enableDoubleClickCanvas = true,
    enableAltDuplicate = true,
    enableShiftConstrain = true,
    onDoubleClickNode,
    onDoubleClickCanvas,
    onNodeDuplicate,
  } = config;

  const reactFlow = useReactFlow();

  const [gestureState, setGestureState] = useState<GestureState>({
    isPanning: false,
    isSpaceHeld: false,
    isAltHeld: false,
    isShiftHeld: false,
    isCtrlHeld: false,
    dragStart: null,
    dragCurrent: null,
  });

  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  // ========================================================================
  // Space + Drag Panning
  // ========================================================================

  useEffect(() => {
    if (!enablePanOnSpace) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !gestureState.isSpaceHeld) {
        e.preventDefault();
        setGestureState((prev) => ({ ...prev, isSpaceHeld: true }));
        document.body.style.cursor = "grab";
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setGestureState((prev) => ({
          ...prev,
          isSpaceHeld: false,
          isPanning: false,
        }));
        document.body.style.cursor = "default";
        panStartRef.current = null;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.body.style.cursor = "default";
    };
  }, [enablePanOnSpace, gestureState.isSpaceHeld]);

  // ========================================================================
  // Mouse Events
  // ========================================================================

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Middle mouse button panning
      if (enableMiddleMousePan && e.button === 1) {
        e.preventDefault();
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setGestureState((prev) => ({ ...prev, isPanning: true }));
        document.body.style.cursor = "grabbing";
      }

      // Space + Left click panning
      if (enablePanOnSpace && gestureState.isSpaceHeld && e.button === 0) {
        e.preventDefault();
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setGestureState((prev) => ({ ...prev, isPanning: true }));
        document.body.style.cursor = "grabbing";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (gestureState.isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;

        const viewport = reactFlow.getViewport();
        reactFlow.setViewport({
          x: viewport.x + dx,
          y: viewport.y + dy,
          zoom: viewport.zoom,
        });

        panStartRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1 || (gestureState.isSpaceHeld && e.button === 0)) {
        setGestureState((prev) => ({ ...prev, isPanning: false }));
        panStartRef.current = null;
        document.body.style.cursor = gestureState.isSpaceHeld
          ? "grab"
          : "default";
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    enableMiddleMousePan,
    enablePanOnSpace,
    gestureState.isPanning,
    gestureState.isSpaceHeld,
    reactFlow,
  ]);

  // ========================================================================
  // Ctrl + Scroll Zoom
  // ========================================================================

  useEffect(() => {
    if (!enableZoomOnCtrlScroll) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        const delta = e.deltaY;
        const zoomAmount = delta > 0 ? 0.9 : 1.1;

        const viewport = reactFlow.getViewport();
        const newZoom = Math.max(0.1, Math.min(2, viewport.zoom * zoomAmount));

        reactFlow.setViewport({
          ...viewport,
          zoom: newZoom,
        });
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleWheel);
    };
  }, [enableZoomOnCtrlScroll, reactFlow]);

  // ========================================================================
  // Modifier Keys Tracking
  // ========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setGestureState((prev) => ({
        ...prev,
        isAltHeld: e.altKey,
        isShiftHeld: e.shiftKey,
        isCtrlHeld: e.ctrlKey || e.metaKey,
      }));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setGestureState((prev) => ({
        ...prev,
        isAltHeld: e.altKey,
        isShiftHeld: e.shiftKey,
        isCtrlHeld: e.ctrlKey || e.metaKey,
      }));
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ========================================================================
  // Axis Constraint (Shift + Drag)
  // ========================================================================

  const constrainToAxis = useCallback(
    (
      position: { x: number; y: number },
      startPosition: { x: number; y: number }
    ) => {
      if (!enableShiftConstrain || !gestureState.isShiftHeld) {
        return position;
      }

      const dx = Math.abs(position.x - startPosition.x);
      const dy = Math.abs(position.y - startPosition.y);

      // Lock to dominant axis
      if (dx > dy) {
        return { x: position.x, y: startPosition.y };
      } else {
        return { x: startPosition.x, y: position.y };
      }
    },
    [enableShiftConstrain, gestureState.isShiftHeld]
  );

  // ========================================================================
  // Double Click Handlers
  // ========================================================================

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      if (enableDoubleClickNode && onDoubleClickNode) {
        onDoubleClickNode(nodeId);
      }
    },
    [enableDoubleClickNode, onDoubleClickNode]
  );

  const handleCanvasDoubleClick = useCallback(
    (position: { x: number; y: number }) => {
      if (enableDoubleClickCanvas && onDoubleClickCanvas) {
        onDoubleClickCanvas(position);
      }
    },
    [enableDoubleClickCanvas, onDoubleClickCanvas]
  );

  // ========================================================================
  // Return API
  // ========================================================================

  return {
    gestureState,
    constrainToAxis,
    handleNodeDoubleClick,
    handleCanvasDoubleClick,
    isPanMode: gestureState.isSpaceHeld || gestureState.isPanning,
    isAltHeld: gestureState.isAltHeld,
    isShiftHeld: gestureState.isShiftHeld,
    isCtrlHeld: gestureState.isCtrlHeld,
  };
}

// ============================================================================
// Gesture Hints Component
// ============================================================================

export function GestureHints() {
  const [showHints, setShowHints] = useState(true);

  if (!showHints) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 max-w-md">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 text-xs text-gray-300">
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-900 border border-gray-700 rounded font-mono">
              Space
            </kbd>
            <span>+ Drag to pan</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-900 border border-gray-700 rounded font-mono">
              Ctrl
            </kbd>
            <span>+ Scroll to zoom</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-900 border border-gray-700 rounded font-mono">
              Shift
            </kbd>
            <span>+ Drag to constrain axis</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-900 border border-gray-700 rounded font-mono">
              Alt
            </kbd>
            <span>+ Drag to duplicate</span>
          </div>
        </div>
        <button
          onClick={() => setShowHints(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default useCanvasGestures;
