/**
 * Canvas Store - Combined store from individual slices
 *
 * This is the main entry point for the canvas store.
 * It combines all individual slices using Zustand's slice pattern.
 *
 * The store is split into the following slices:
 * - Workflow: Workflow state and validation
 * - Action: Action CRUD operations
 * - Connection: Connection management
 * - Selection: Node and edge selection
 * - Clipboard: Copy/paste operations
 * - History: Undo/redo functionality
 * - Viewport: Pan, zoom, and viewport state
 * - Preferences: UI preferences
 *
 * Each slice is independently testable and has a single responsibility.
 *
 * Performance optimizations:
 * - Immer for immutable updates
 * - Devtools integration
 * - Persisted preferences
 * - Selective re-renders through selectors
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { CanvasStore } from './types';
import { createWorkflowSlice } from './workflow-slice';
import { createActionSlice } from './action-slice';
import { createConnectionSlice } from './connection-slice';
import { createSelectionSlice } from './selection-slice';
import { createClipboardSlice } from './clipboard-slice';
import { createHistorySlice } from './history-slice';
import { createViewportSlice } from './viewport-slice';
import { createPreferencesSlice } from './preferences-slice';

// ============================================================================
// Combined Store
// ============================================================================

export const useCanvasStore = create<CanvasStore>()(
  devtools(
    immer(
      persist(
        (...a) => ({
          ...createWorkflowSlice(...a),
          ...createActionSlice(...a),
          ...createConnectionSlice(...a),
          ...createSelectionSlice(...a),
          ...createClipboardSlice(...a),
          ...createHistorySlice(...a),
          ...createViewportSlice(...a),
          ...createPreferencesSlice(...a),
        }),
        {
          name: 'canvas-storage',
          partialize: (state) => ({
            viewport: state.viewport,
            showMinimap: state.showMinimap,
            showGrid: state.showGrid,
            snapToGrid: state.snapToGrid,
            gridSize: state.gridSize,
          }),
        }
      )
    ),
    { name: 'CanvasStore' }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

/**
 * Workflow selectors
 */
export const useWorkflow = () => useCanvasStore((state) => state.workflow);
export const useIsDirty = () => useCanvasStore((state) => state.isDirty);
export const useValidationResult = () => useCanvasStore((state) => state.validationResult);

/**
 * Action selectors
 */
export const useActions = () => useCanvasStore((state) => state.workflow?.actions ?? []);
export const useActionById = (id: string) =>
  useCanvasStore((state) => state.workflow?.actions.find((a) => a.id === id));

/**
 * Connection selectors
 */
export const useConnections = () => useCanvasStore((state) => state.workflow?.connections ?? {});
export const useIsConnecting = () => useCanvasStore((state) => state.isConnecting);
export const useConnectingFrom = () => useCanvasStore((state) => state.connectingFrom);

/**
 * Selection selectors
 */
export const useSelectedNodes = () => useCanvasStore((state) => state.selectedNodes);
export const useSelectedEdges = () => useCanvasStore((state) => state.selectedEdges);
export const useHasSelection = () =>
  useCanvasStore(
    (state) => state.selectedNodes.length > 0 || state.selectedEdges.length > 0
  );

/**
 * Clipboard selectors
 */
export const useCanPaste = () => useCanvasStore((state) => state.clipboardNodes.length > 0);

/**
 * History selectors
 */
export const useCanUndo = () => useCanvasStore((state) => state.canUndo());
export const useCanRedo = () => useCanvasStore((state) => state.canRedo());
export const useHistoryIndex = () => useCanvasStore((state) => state.historyIndex);
export const useHistoryLength = () => useCanvasStore((state) => state.history.length);

/**
 * Viewport selectors
 */
export const useViewport = () => useCanvasStore((state) => state.viewport);
export const useZoom = () => useCanvasStore((state) => state.viewport.zoom);
export const useIsDragging = () => useCanvasStore((state) => state.isDragging);
export const useIsPanning = () => useCanvasStore((state) => state.isPanning);

/**
 * Preferences selectors
 */
export const useShowMinimap = () => useCanvasStore((state) => state.showMinimap);
export const useShowGrid = () => useCanvasStore((state) => state.showGrid);
export const useSnapToGrid = () => useCanvasStore((state) => state.snapToGrid);
export const useGridSize = () => useCanvasStore((state) => state.gridSize);

// ============================================================================
// Re-exports
// ============================================================================

export type * from './types';
