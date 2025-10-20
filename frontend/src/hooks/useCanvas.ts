/**
 * Canvas Hooks - React hooks for canvas state management
 *
 * Provides convenient hooks for accessing and manipulating canvas state:
 * - useCanvas() - Main canvas store hook
 * - useCanvasActions() - Action CRUD operations
 * - useCanvasSelection() - Selection state and actions
 * - useCanvasHistory() - Undo/redo operations
 * - useCanvasClipboard() - Clipboard operations
 * - useCanvasViewport() - Viewport management
 */

import { useCallback, useMemo } from 'react';
import { useCanvasStore } from '../stores/canvas-store';
import type { Action, Workflow, Connection } from '../lib/action-schema/action-types';
import type { Viewport, ValidationResult } from '../stores/canvas-store';

// ============================================================================
// Main Canvas Hook
// ============================================================================

/**
 * Main hook for accessing canvas state and actions
 */
export function useCanvas() {
  const store = useCanvasStore();

  return {
    // State
    workflow: store.workflow,
    isDirty: store.isDirty,
    selectedNodes: store.selectedNodes,
    selectedEdges: store.selectedEdges,
    viewport: store.viewport,
    validationResult: store.validationResult,

    // All actions available
    ...store,
  };
}

// ============================================================================
// Canvas Actions Hook
// ============================================================================

/**
 * Hook for action CRUD operations
 */
export function useCanvasActions() {
  const addAction = useCanvasStore(state => state.addAction);
  const updateAction = useCanvasStore(state => state.updateAction);
  const deleteAction = useCanvasStore(state => state.deleteAction);
  const deleteActions = useCanvasStore(state => state.deleteActions);
  const duplicateAction = useCanvasStore(state => state.duplicateAction);
  const moveAction = useCanvasStore(state => state.moveAction);
  const moveActions = useCanvasStore(state => state.moveActions);
  const getActionById = useCanvasStore(state => state.getActionById);
  const findActionsByType = useCanvasStore(state => state.findActionsByType);

  const workflow = useCanvasStore(state => state.workflow);
  const actions = useMemo(() => workflow?.actions || [], [workflow]);

  return {
    // State
    actions,

    // Operations
    addAction,
    updateAction,
    deleteAction,
    deleteActions,
    duplicateAction,
    moveAction,
    moveActions,
    getActionById,
    findActionsByType,
  };
}

// ============================================================================
// Canvas Selection Hook
// ============================================================================

/**
 * Hook for selection state and operations
 */
export function useCanvasSelection() {
  const selectedNodes = useCanvasStore(state => state.selectedNodes);
  const selectedEdges = useCanvasStore(state => state.selectedEdges);
  const selectNode = useCanvasStore(state => state.selectNode);
  const selectNodes = useCanvasStore(state => state.selectNodes);
  const selectEdge = useCanvasStore(state => state.selectEdge);
  const clearSelection = useCanvasStore(state => state.clearSelection);
  const selectAll = useCanvasStore(state => state.selectAll);
  const invertSelection = useCanvasStore(state => state.invertSelection);

  const hasSelection = useMemo(
    () => selectedNodes.length > 0 || selectedEdges.length > 0,
    [selectedNodes, selectedEdges]
  );

  const selectionCount = useMemo(
    () => ({
      nodes: selectedNodes.length,
      edges: selectedEdges.length,
      total: selectedNodes.length + selectedEdges.length,
    }),
    [selectedNodes, selectedEdges]
  );

  return {
    // State
    selectedNodes,
    selectedEdges,
    hasSelection,
    selectionCount,

    // Operations
    selectNode,
    selectNodes,
    selectEdge,
    clearSelection,
    selectAll,
    invertSelection,
  };
}

// ============================================================================
// Canvas History Hook
// ============================================================================

/**
 * Hook for undo/redo operations
 */
export function useCanvasHistory() {
  const undo = useCanvasStore(state => state.undo);
  const redo = useCanvasStore(state => state.redo);
  const canUndo = useCanvasStore(state => state.canUndo);
  const canRedo = useCanvasStore(state => state.canRedo);
  const recordHistory = useCanvasStore(state => state.recordHistory);
  const clearHistory = useCanvasStore(state => state.clearHistory);

  const history = useCanvasStore(state => state.history);
  const historyIndex = useCanvasStore(state => state.historyIndex);

  const historyInfo = useMemo(
    () => ({
      canUndo: canUndo(),
      canRedo: canRedo(),
      currentIndex: historyIndex,
      totalEntries: history.length,
    }),
    [canUndo, canRedo, historyIndex, history.length]
  );

  return {
    // State
    ...historyInfo,

    // Operations
    undo,
    redo,
    recordHistory,
    clearHistory,
  };
}

// ============================================================================
// Canvas Clipboard Hook
// ============================================================================

/**
 * Hook for clipboard operations
 */
export function useCanvasClipboard() {
  const copy = useCanvasStore(state => state.copy);
  const paste = useCanvasStore(state => state.paste);
  const cut = useCanvasStore(state => state.cut);
  const duplicate = useCanvasStore(state => state.duplicate);
  const clipboardNodes = useCanvasStore(state => state.clipboardNodes);

  const hasClipboard = useMemo(() => clipboardNodes.length > 0, [clipboardNodes]);

  return {
    // State
    hasClipboard,
    clipboardCount: clipboardNodes.length,

    // Operations
    copy,
    paste,
    cut,
    duplicate,
  };
}

// ============================================================================
// Canvas Viewport Hook
// ============================================================================

/**
 * Hook for viewport management
 */
export function useCanvasViewport() {
  const viewport = useCanvasStore(state => state.viewport);
  const setViewport = useCanvasStore(state => state.setViewport);
  const fitView = useCanvasStore(state => state.fitView);
  const zoomIn = useCanvasStore(state => state.zoomIn);
  const zoomOut = useCanvasStore(state => state.zoomOut);
  const resetZoom = useCanvasStore(state => state.resetZoom);

  return {
    // State
    viewport,
    zoom: viewport.zoom,
    x: viewport.x,
    y: viewport.y,

    // Operations
    setViewport,
    fitView,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}

// ============================================================================
// Canvas Connections Hook
// ============================================================================

/**
 * Hook for connection operations
 */
export function useCanvasConnections() {
  const addConnection = useCanvasStore(state => state.addConnection);
  const deleteConnection = useCanvasStore(state => state.deleteConnection);
  const deleteConnectionsForAction = useCanvasStore(state => state.deleteConnectionsForAction);
  const startConnecting = useCanvasStore(state => state.startConnecting);
  const finishConnecting = useCanvasStore(state => state.finishConnecting);
  const cancelConnecting = useCanvasStore(state => state.cancelConnecting);
  const getConnectionsForAction = useCanvasStore(state => state.getConnectionsForAction);

  const isConnecting = useCanvasStore(state => state.isConnecting);
  const connectingFrom = useCanvasStore(state => state.connectingFrom);

  const workflow = useCanvasStore(state => state.workflow);
  const connections = useMemo(() => workflow?.connections || {}, [workflow]);

  return {
    // State
    connections,
    isConnecting,
    connectingFrom,

    // Operations
    addConnection,
    deleteConnection,
    deleteConnectionsForAction,
    startConnecting,
    finishConnecting,
    cancelConnecting,
    getConnectionsForAction,
  };
}

// ============================================================================
// Canvas Validation Hook
// ============================================================================

/**
 * Hook for workflow validation
 */
export function useCanvasValidation() {
  const validateWorkflow = useCanvasStore(state => state.validateWorkflow);
  const clearValidation = useCanvasStore(state => state.clearValidation);
  const validationResult = useCanvasStore(state => state.validationResult);
  const isValidating = useCanvasStore(state => state.isValidating);

  const validate = useCallback(() => {
    return validateWorkflow();
  }, [validateWorkflow]);

  const validationSummary = useMemo(() => {
    if (!validationResult) {
      return {
        isValid: true,
        errorCount: 0,
        warningCount: 0,
        hasErrors: false,
        hasWarnings: false,
      };
    }

    return {
      isValid: validationResult.valid,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
      hasErrors: validationResult.errors.length > 0,
      hasWarnings: validationResult.warnings.length > 0,
    };
  }, [validationResult]);

  return {
    // State
    validationResult,
    isValidating,
    ...validationSummary,

    // Operations
    validate,
    clearValidation,
  };
}

// ============================================================================
// Canvas UI Settings Hook
// ============================================================================

/**
 * Hook for UI settings
 */
export function useCanvasUI() {
  const showMinimap = useCanvasStore(state => state.showMinimap);
  const showGrid = useCanvasStore(state => state.showGrid);
  const snapToGrid = useCanvasStore(state => state.snapToGrid);
  const gridSize = useCanvasStore(state => state.gridSize);

  const toggleMinimap = useCanvasStore(state => state.toggleMinimap);
  const toggleGrid = useCanvasStore(state => state.toggleGrid);
  const toggleSnapToGrid = useCanvasStore(state => state.toggleSnapToGrid);
  const setGridSize = useCanvasStore(state => state.setGridSize);

  return {
    // State
    showMinimap,
    showGrid,
    snapToGrid,
    gridSize,

    // Operations
    toggleMinimap,
    toggleGrid,
    toggleSnapToGrid,
    setGridSize,
  };
}

// ============================================================================
// Canvas Editing State Hook
// ============================================================================

/**
 * Hook for editing state
 */
export function useCanvasEditingState() {
  const isDragging = useCanvasStore(state => state.isDragging);
  const isConnecting = useCanvasStore(state => state.isConnecting);
  const isPanning = useCanvasStore(state => state.isPanning);
  const setDragging = useCanvasStore(state => state.setDragging);
  const setPanning = useCanvasStore(state => state.setPanning);

  const isEditing = useMemo(
    () => isDragging || isConnecting || isPanning,
    [isDragging, isConnecting, isPanning]
  );

  return {
    // State
    isDragging,
    isConnecting,
    isPanning,
    isEditing,

    // Operations
    setDragging,
    setPanning,
  };
}

// ============================================================================
// Canvas Workflow Hook
// ============================================================================

/**
 * Hook for workflow operations
 */
export function useCanvasWorkflow() {
  const workflow = useCanvasStore(state => state.workflow);
  const isDirty = useCanvasStore(state => state.isDirty);
  const setWorkflow = useCanvasStore(state => state.setWorkflow);
  const clearWorkflow = useCanvasStore(state => state.clearWorkflow);
  const saveWorkflow = useCanvasStore(state => state.saveWorkflow);

  const workflowInfo = useMemo(() => {
    if (!workflow) {
      return {
        hasWorkflow: false,
        actionCount: 0,
        connectionCount: 0,
        name: '',
        id: '',
      };
    }

    const connectionCount = Object.values(workflow.connections).reduce((count, sourceConn) => {
      return (
        count +
        Object.values(sourceConn).reduce((typeCount, outputs) => {
          return typeCount + (outputs?.reduce((sum, arr) => sum + arr.length, 0) || 0);
        }, 0)
      );
    }, 0);

    return {
      hasWorkflow: true,
      actionCount: workflow.actions.length,
      connectionCount,
      name: workflow.name,
      id: workflow.id,
    };
  }, [workflow]);

  return {
    // State
    workflow,
    isDirty,
    ...workflowInfo,

    // Operations
    setWorkflow,
    clearWorkflow,
    saveWorkflow,
  };
}

// ============================================================================
// Composite Hook - useCanvasOperations
// ============================================================================

/**
 * Composite hook combining common canvas operations
 */
export function useCanvasOperations() {
  const actions = useCanvasActions();
  const selection = useCanvasSelection();
  const history = useCanvasHistory();
  const clipboard = useCanvasClipboard();
  const connections = useCanvasConnections();
  const validation = useCanvasValidation();

  // Derived operations
  const deleteSelected = useCallback(() => {
    if (selection.selectedNodes.length > 0) {
      actions.deleteActions(selection.selectedNodes);
      selection.clearSelection();
    }
  }, [actions, selection]);

  const duplicateSelected = useCallback(() => {
    if (selection.selectedNodes.length > 0) {
      clipboard.duplicate();
    }
  }, [clipboard, selection]);

  const copySelected = useCallback(() => {
    if (selection.selectedNodes.length > 0) {
      clipboard.copy();
    }
  }, [clipboard, selection]);

  const cutSelected = useCallback(() => {
    if (selection.selectedNodes.length > 0) {
      clipboard.cut();
    }
  }, [clipboard, selection]);

  return {
    // Sub-hooks
    actions,
    selection,
    history,
    clipboard,
    connections,
    validation,

    // Composite operations
    deleteSelected,
    duplicateSelected,
    copySelected,
    cutSelected,
  };
}
