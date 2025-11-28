/**
 * Palette Drag-and-Drop System
 *
 * Implements HTML5 drag-and-drop for adding nodes from palette to canvas.
 * Handles ghost images, drop zones, position calculation, and grid snapping.
 */

import { RefObject, useCallback, useState, useEffect, useRef } from "react";
import { ActionType, createAction } from "@/lib/action-schema/action-types";
import { getDefaultConfig } from "@/lib/action-schema/default-configs";
import { useCanvasStore } from "@/stores/canvas-store";
import { useReactFlow, ReactFlowInstance } from "@xyflow/react";

// ============================================================================
// Types
// ============================================================================

export interface DragPosition {
  x: number;
  y: number;
}

export interface DropZoneInfo {
  canDrop: boolean;
  position: DragPosition;
  snappedPosition?: DragPosition;
}

export interface PaletteDragState {
  isDragging: boolean;
  draggedType: ActionType | null;
  ghostElement: HTMLElement | null;
  dropZone: DropZoneInfo | null;
}

export interface PaletteDragHandlers {
  onDragStart: (nodeType: ActionType, event: React.DragEvent) => void;
  onDragEnd: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  isDragging: boolean;
  draggedType: ActionType | null;
}

// ============================================================================
// Constants
// ============================================================================

const DRAG_DATA_TYPE = "application/qontinui-node";
const GHOST_OFFSET_X = 20;
const GHOST_OFFSET_Y = 20;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a ghost image element for dragging
 */
function createGhostElement(
  nodeType: ActionType,
  displayName: string
): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "node-palette-ghost";
  ghost.innerHTML = `
    <div class="ghost-content">
      <div class="ghost-icon">+</div>
      <div class="ghost-label">${displayName}</div>
    </div>
  `;
  ghost.style.position = "absolute";
  ghost.style.top = "-9999px";
  ghost.style.left = "-9999px";
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "0.8";
  ghost.style.zIndex = "9999";

  document.body.appendChild(ghost);
  return ghost;
}

/**
 * Clean up ghost element
 */
function removeGhostElement(ghost: HTMLElement | null) {
  if (ghost && ghost.parentNode) {
    ghost.parentNode.removeChild(ghost);
  }
}

/**
 * Convert screen coordinates to workflow coordinates
 */
function screenToWorkflow(
  screenX: number,
  screenY: number,
  canvasRect: DOMRect,
  zoom: number,
  panX: number,
  panY: number
): DragPosition {
  // Adjust for canvas position
  const relativeX = screenX - canvasRect.left;
  const relativeY = screenY - canvasRect.top;

  // Convert to workflow coordinates accounting for zoom and pan
  const workflowX = (relativeX - panX) / zoom;
  const workflowY = (relativeY - panY) / zoom;

  return { x: workflowX, y: workflowY };
}

/**
 * Snap position to grid
 */
function snapToGrid(position: DragPosition, gridSize: number): DragPosition {
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  };
}

/**
 * Check if position is within canvas bounds
 */
function isValidDropZone(position: DragPosition, canvasRect: DOMRect): boolean {
  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.x <= canvasRect.width &&
    position.y <= canvasRect.height
  );
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Custom hook for palette drag-and-drop functionality
 */
export function usePaletteDrag(
  canvasRef: RefObject<HTMLElement>
): PaletteDragHandlers {
  const [state, setState] = useState<PaletteDragState>({
    isDragging: false,
    draggedType: null,
    ghostElement: null,
    dropZone: null,
  });

  const {
    addAction,
    snapToGrid: shouldSnap,
    gridSize,
    viewport,
  } = useCanvasStore();
  const reactFlowInstance = useReactFlow();

  // Clean up ghost element on unmount
  useEffect(() => {
    return () => {
      if (state.ghostElement) {
        removeGhostElement(state.ghostElement);
      }
    };
  }, [state.ghostElement]);

  // Handle Escape key to cancel drag
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.isDragging) {
        setState((prev) => ({
          ...prev,
          isDragging: false,
          draggedType: null,
          dropZone: null,
        }));
        if (state.ghostElement) {
          removeGhostElement(state.ghostElement);
        }
      }
    };

    if (state.isDragging) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [state.isDragging, state.ghostElement]);

  const onDragStart = useCallback(
    (nodeType: ActionType, event: React.DragEvent) => {
      // Set drag data
      event.dataTransfer.setData(DRAG_DATA_TYPE, nodeType);
      event.dataTransfer.effectAllowed = "copy";

      // Create ghost element
      const displayName = nodeType; // Would get from metadata in real implementation
      const ghost = createGhostElement(nodeType, displayName);

      // Set custom drag image
      if (event.dataTransfer.setDragImage) {
        event.dataTransfer.setDragImage(ghost, GHOST_OFFSET_X, GHOST_OFFSET_Y);
      }

      setState({
        isDragging: true,
        draggedType: nodeType,
        ghostElement: ghost,
        dropZone: null,
      });
    },
    []
  );

  const onDragEnd = useCallback(
    (event: React.DragEvent) => {
      // Clean up
      if (state.ghostElement) {
        removeGhostElement(state.ghostElement);
      }

      setState({
        isDragging: false,
        draggedType: null,
        ghostElement: null,
        dropZone: null,
      });
    },
    [state.ghostElement]
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";

      if (!canvasRef.current || !state.isDragging) return;

      const canvasRect = canvasRef.current.getBoundingClientRect();

      // Convert screen to workflow coordinates
      const position = screenToWorkflow(
        event.clientX,
        event.clientY,
        canvasRect,
        viewport.zoom,
        viewport.x,
        viewport.y
      );

      // Apply grid snapping if enabled
      const snappedPosition = shouldSnap
        ? snapToGrid(position, gridSize)
        : position;

      // Check if valid drop zone
      const canDrop = isValidDropZone(position, canvasRect);

      setState((prev) => ({
        ...prev,
        dropZone: {
          canDrop,
          position,
          snappedPosition,
        },
      }));
    },
    [canvasRef, state.isDragging, viewport, shouldSnap, gridSize]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!canvasRef.current || !state.draggedType) return;

      const canvasRect = canvasRef.current.getBoundingClientRect();

      // Get drop position using React Flow's project function
      const position = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX - canvasRect.left,
        y: event.clientY - canvasRect.top,
      }) || { x: 0, y: 0 };

      // Apply grid snapping if enabled
      const finalPosition = shouldSnap
        ? snapToGrid(position, gridSize)
        : position;

      // Create new action at drop position with proper default config
      const newAction = createAction(
        state.draggedType,
        getDefaultConfig(state.draggedType),
        [finalPosition.x, finalPosition.y]
      );

      // Add to canvas
      addAction(newAction);

      // Clean up
      if (state.ghostElement) {
        removeGhostElement(state.ghostElement);
      }

      setState({
        isDragging: false,
        draggedType: null,
        ghostElement: null,
        dropZone: null,
      });
    },
    [
      canvasRef,
      state.draggedType,
      state.ghostElement,
      addAction,
      shouldSnap,
      gridSize,
      reactFlowInstance,
    ]
  );

  return {
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    isDragging: state.isDragging,
    draggedType: state.draggedType,
  };
}

// ============================================================================
// Click-to-Add Helper
// ============================================================================

/**
 * Hook for click-to-add functionality (adds node at viewport center)
 */
export function useClickToAdd() {
  const { addAction, viewport } = useCanvasStore();
  const reactFlowInstance = useReactFlow();

  const addNodeAtCenter = useCallback(
    (nodeType: ActionType) => {
      if (!reactFlowInstance) return;

      // Get viewport center
      const center = reactFlowInstance.getViewport();

      // Calculate center position in workflow coordinates
      // Viewport center is at the middle of the visible area
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const centerPosition = reactFlowInstance.screenToFlowPosition({
        x: viewportWidth / 2,
        y: viewportHeight / 2,
      });

      // Create action at center with proper default config
      const newAction = createAction(nodeType, getDefaultConfig(nodeType), [
        centerPosition.x,
        centerPosition.y,
      ]);

      addAction(newAction);
    },
    [addAction, reactFlowInstance]
  );

  const addNodeAtPosition = useCallback(
    (nodeType: ActionType, x: number, y: number) => {
      const newAction = createAction(nodeType, getDefaultConfig(nodeType), [
        x,
        y,
      ]);

      addAction(newAction);
    },
    [addAction]
  );

  return {
    addNodeAtCenter,
    addNodeAtPosition,
  };
}

// ============================================================================
// Ghost Element Styles (CSS-in-JS fallback)
// ============================================================================

/**
 * Inject ghost element styles if not present
 */
export function injectGhostStyles() {
  if (document.getElementById("palette-ghost-styles")) return;

  const style = document.createElement("style");
  style.id = "palette-ghost-styles";
  style.textContent = `
    .node-palette-ghost {
      background: white;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      padding: 8px 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: system-ui, -apple-system, sans-serif;
    }

    .ghost-content {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ghost-icon {
      width: 24px;
      height: 24px;
      background: #3b82f6;
      color: white;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }

    .ghost-label {
      font-size: 14px;
      font-weight: 500;
      color: #1f2937;
      white-space: nowrap;
    }
  `;

  document.head.appendChild(style);
}
