/**
 * Selection Manager - Advanced selection handling for canvas
 *
 * Features:
 * - Multi-select with Ctrl/Cmd
 * - Range select with Shift
 * - Rectangle select (drag to select)
 * - Select all (Ctrl+A)
 * - Invert selection
 * - Selection persistence
 * - Selection groups
 */

import type { Action } from '../lib/action-schema/action-types';

// ============================================================================
// Types
// ============================================================================

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionGroup {
  id: string;
  name: string;
  nodeIds: string[];
  created: number;
}

export interface SelectionState {
  /** Currently selected node IDs */
  selectedNodes: Set<string>;

  /** Currently selected edge IDs */
  selectedEdges: Set<string>;

  /** Last selected node (for range selection) */
  lastSelected: string | null;

  /** Selection mode */
  mode: 'single' | 'multi' | 'range' | 'rect';

  /** Rectangle selection bounds */
  selectionRect: SelectionRect | null;

  /** Saved selection groups */
  groups: SelectionGroup[];

  /** Selection history for undo/redo */
  history: Array<{ nodes: Set<string>; edges: Set<string> }>;

  /** Current position in selection history */
  historyIndex: number;
}

// ============================================================================
// Selection Manager Class
// ============================================================================

export class SelectionManager {
  private state: SelectionState;
  private listeners: Set<(state: SelectionState) => void> = new Set();

  constructor() {
    this.state = {
      selectedNodes: new Set(),
      selectedEdges: new Set(),
      lastSelected: null,
      mode: 'single',
      selectionRect: null,
      groups: [],
      history: [],
      historyIndex: -1,
    };
  }

  // ==========================================================================
  // Node Selection
  // ==========================================================================

  /**
   * Select a single node
   */
  selectNode(nodeId: string, multi = false): void {
    if (multi) {
      if (this.state.selectedNodes.has(nodeId)) {
        this.state.selectedNodes.delete(nodeId);
      } else {
        this.state.selectedNodes.add(nodeId);
      }
    } else {
      this.state.selectedNodes.clear();
      this.state.selectedNodes.add(nodeId);
    }

    this.state.selectedEdges.clear();
    this.state.lastSelected = nodeId;
    this.state.mode = multi ? 'multi' : 'single';

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Select multiple nodes
   */
  selectNodes(nodeIds: string[], multi = false): void {
    if (!multi) {
      this.state.selectedNodes.clear();
    }

    nodeIds.forEach(id => this.state.selectedNodes.add(id));

    this.state.selectedEdges.clear();
    this.state.lastSelected = nodeIds[nodeIds.length - 1] || null;
    this.state.mode = 'multi';

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Select range of nodes (from last selected to current)
   */
  selectRange(nodeId: string, actions: Action[]): void {
    if (!this.state.lastSelected) {
      this.selectNode(nodeId);
      return;
    }

    // Find indices of start and end nodes
    const startIndex = actions.findIndex(a => a.id === this.state.lastSelected);
    const endIndex = actions.findIndex(a => a.id === nodeId);

    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    // Select all nodes in range
    const [min, max] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
    const rangeNodeIds = actions.slice(min, max + 1).map(a => a.id);

    this.selectNodes(rangeNodeIds, false);
    this.state.mode = 'range';
  }

  /**
   * Select nodes within a rectangle
   */
  selectInRect(rect: SelectionRect, actions: Action[], append = false): void {
    const nodesInRect = actions.filter(action => {
      const [x, y] = action.position;
      return (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      );
    });

    if (!append) {
      this.state.selectedNodes.clear();
    }

    nodesInRect.forEach(action => this.state.selectedNodes.add(action.id));

    this.state.selectedEdges.clear();
    this.state.mode = 'rect';
    this.state.selectionRect = rect;

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Deselect a node
   */
  deselectNode(nodeId: string): void {
    this.state.selectedNodes.delete(nodeId);

    if (this.state.lastSelected === nodeId) {
      this.state.lastSelected = null;
    }

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Deselect multiple nodes
   */
  deselectNodes(nodeIds: string[]): void {
    nodeIds.forEach(id => this.state.selectedNodes.delete(id));

    this.recordHistory();
    this.notifyListeners();
  }

  // ==========================================================================
  // Edge Selection
  // ==========================================================================

  /**
   * Select an edge
   */
  selectEdge(edgeId: string, multi = false): void {
    if (multi) {
      if (this.state.selectedEdges.has(edgeId)) {
        this.state.selectedEdges.delete(edgeId);
      } else {
        this.state.selectedEdges.add(edgeId);
      }
    } else {
      this.state.selectedEdges.clear();
      this.state.selectedEdges.add(edgeId);
    }

    this.state.selectedNodes.clear();
    this.state.lastSelected = null;

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Select multiple edges
   */
  selectEdges(edgeIds: string[], multi = false): void {
    if (!multi) {
      this.state.selectedEdges.clear();
    }

    edgeIds.forEach(id => this.state.selectedEdges.add(id));

    this.state.selectedNodes.clear();
    this.state.lastSelected = null;

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Deselect an edge
   */
  deselectEdge(edgeId: string): void {
    this.state.selectedEdges.delete(edgeId);

    this.recordHistory();
    this.notifyListeners();
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Select all nodes
   */
  selectAll(actions: Action[]): void {
    this.state.selectedNodes.clear();
    this.state.selectedEdges.clear();

    actions.forEach(action => this.state.selectedNodes.add(action.id));

    this.state.mode = 'multi';

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Clear all selection
   */
  clearSelection(): void {
    this.state.selectedNodes.clear();
    this.state.selectedEdges.clear();
    this.state.lastSelected = null;
    this.state.selectionRect = null;

    this.recordHistory();
    this.notifyListeners();
  }

  /**
   * Invert selection
   */
  invertSelection(actions: Action[]): void {
    const allNodeIds = new Set(actions.map(a => a.id));
    const currentSelection = new Set(this.state.selectedNodes);

    this.state.selectedNodes.clear();

    allNodeIds.forEach(id => {
      if (!currentSelection.has(id)) {
        this.state.selectedNodes.add(id);
      }
    });

    this.state.selectedEdges.clear();

    this.recordHistory();
    this.notifyListeners();
  }

  // ==========================================================================
  // Selection Groups
  // ==========================================================================

  /**
   * Save current selection as a named group
   */
  saveGroup(name: string): SelectionGroup {
    const group: SelectionGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      nodeIds: Array.from(this.state.selectedNodes),
      created: Date.now(),
    };

    this.state.groups.push(group);
    this.notifyListeners();

    return group;
  }

  /**
   * Load a selection group
   */
  loadGroup(groupId: string): boolean {
    const group = this.state.groups.find(g => g.id === groupId);
    if (!group) return false;

    this.state.selectedNodes = new Set(group.nodeIds);
    this.state.selectedEdges.clear();
    this.state.mode = 'multi';

    this.recordHistory();
    this.notifyListeners();

    return true;
  }

  /**
   * Delete a selection group
   */
  deleteGroup(groupId: string): boolean {
    const index = this.state.groups.findIndex(g => g.id === groupId);
    if (index === -1) return false;

    this.state.groups.splice(index, 1);
    this.notifyListeners();

    return true;
  }

  /**
   * Get all selection groups
   */
  getGroups(): SelectionGroup[] {
    return [...this.state.groups];
  }

  // ==========================================================================
  // History
  // ==========================================================================

  /**
   * Record current selection state in history
   */
  private recordHistory(): void {
    // Remove any history after current index
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);

    // Add current state
    this.state.history.push({
      nodes: new Set(this.state.selectedNodes),
      edges: new Set(this.state.selectedEdges),
    });

    // Limit history size
    if (this.state.history.length > 50) {
      this.state.history.shift();
    } else {
      this.state.historyIndex++;
    }
  }

  /**
   * Undo selection change
   */
  undoSelection(): boolean {
    if (this.state.historyIndex <= 0) return false;

    this.state.historyIndex--;
    const historyState = this.state.history[this.state.historyIndex];

    this.state.selectedNodes = new Set(historyState.nodes);
    this.state.selectedEdges = new Set(historyState.edges);

    this.notifyListeners();
    return true;
  }

  /**
   * Redo selection change
   */
  redoSelection(): boolean {
    if (this.state.historyIndex >= this.state.history.length - 1) return false;

    this.state.historyIndex++;
    const historyState = this.state.history[this.state.historyIndex];

    this.state.selectedNodes = new Set(historyState.nodes);
    this.state.selectedEdges = new Set(historyState.edges);

    this.notifyListeners();
    return true;
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Check if a node is selected
   */
  isNodeSelected(nodeId: string): boolean {
    return this.state.selectedNodes.has(nodeId);
  }

  /**
   * Check if an edge is selected
   */
  isEdgeSelected(edgeId: string): boolean {
    return this.state.selectedEdges.has(edgeId);
  }

  /**
   * Get all selected node IDs
   */
  getSelectedNodes(): string[] {
    return Array.from(this.state.selectedNodes);
  }

  /**
   * Get all selected edge IDs
   */
  getSelectedEdges(): string[] {
    return Array.from(this.state.selectedEdges);
  }

  /**
   * Get selection count
   */
  getSelectionCount(): { nodes: number; edges: number } {
    return {
      nodes: this.state.selectedNodes.size,
      edges: this.state.selectedEdges.size,
    };
  }

  /**
   * Check if there's any selection
   */
  hasSelection(): boolean {
    return this.state.selectedNodes.size > 0 || this.state.selectedEdges.size > 0;
  }

  /**
   * Get current selection mode
   */
  getMode(): SelectionState['mode'] {
    return this.state.mode;
  }

  /**
   * Get selection rectangle (if in rect mode)
   */
  getSelectionRect(): SelectionRect | null {
    return this.state.selectionRect;
  }

  /**
   * Set selection rectangle
   */
  setSelectionRect(rect: SelectionRect | null): void {
    this.state.selectionRect = rect;
    this.notifyListeners();
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Get current state
   */
  getState(): SelectionState {
    return {
      ...this.state,
      selectedNodes: new Set(this.state.selectedNodes),
      selectedEdges: new Set(this.state.selectedEdges),
    };
  }

  /**
   * Subscribe to selection changes
   */
  subscribe(listener: (state: SelectionState) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = {
      selectedNodes: new Set(),
      selectedEdges: new Set(),
      lastSelected: null,
      mode: 'single',
      selectionRect: null,
      groups: [],
      history: [],
      historyIndex: -1,
    };

    this.notifyListeners();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      listener(this.getState());
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new selection manager instance
 */
export function createSelectionManager(): SelectionManager {
  return new SelectionManager();
}
