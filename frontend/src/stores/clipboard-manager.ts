/**
 * Clipboard Manager - Copy/paste functionality for canvas
 *
 * Features:
 * - Copy nodes with connections
 * - Paste with offset
 * - Cut (copy + delete)
 * - Duplicate (copy + paste)
 * - ID regeneration on paste
 * - Connection preservation
 * - Cross-window clipboard support
 * - Clipboard history
 */

import type { Action, Connections, Connection } from '../lib/action-schema/action-types';

// ============================================================================
// Types
// ============================================================================

export interface ClipboardData {
  /** Actions being copied */
  actions: Action[];

  /** Connections between copied actions */
  connections: Connections;

  /** Timestamp when copied */
  timestamp: number;

  /** Source workflow ID (for cross-workflow paste) */
  sourceWorkflowId?: string;

  /** Copy operation type */
  operation: 'copy' | 'cut';
}

export interface ClipboardHistoryEntry extends ClipboardData {
  id: string;
}

export interface ClipboardState {
  /** Current clipboard data */
  current: ClipboardData | null;

  /** Clipboard history */
  history: ClipboardHistoryEntry[];

  /** Maximum history size */
  maxHistorySize: number;
}

export interface PasteOptions {
  /** Position offset for pasted nodes */
  offset?: { x: number; y: number };

  /** Absolute position for first node */
  position?: { x: number; y: number };

  /** Generate new IDs (default: true) */
  generateNewIds?: boolean;

  /** Preserve connections (default: true) */
  preserveConnections?: boolean;
}

export interface PasteResult {
  /** Newly created actions */
  actions: Action[];

  /** New connections */
  connections: Connections;

  /** Mapping from old IDs to new IDs */
  idMap: Map<string, string>;
}

// ============================================================================
// Clipboard Manager Class
// ============================================================================

export class ClipboardManager {
  private state: ClipboardState;
  private listeners: Set<(state: ClipboardState) => void> = new Set();

  constructor(maxHistorySize = 10) {
    this.state = {
      current: null,
      history: [],
      maxHistorySize,
    };
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Copy actions to clipboard
   */
  copy(actions: Action[], allConnections: Connections): void {
    const actionIds = new Set(actions.map(a => a.id));

    // Filter connections to only include those between copied actions
    const connections = this.filterConnections(allConnections, actionIds);

    const clipboardData: ClipboardData = {
      actions: JSON.parse(JSON.stringify(actions)), // Deep clone
      connections: JSON.parse(JSON.stringify(connections)),
      timestamp: Date.now(),
      operation: 'copy',
    };

    this.state.current = clipboardData;
    this.addToHistory(clipboardData);
    this.notifyListeners();

    // Try to copy to system clipboard
    this.copyToSystemClipboard(clipboardData);
  }

  /**
   * Cut actions to clipboard
   */
  cut(actions: Action[], allConnections: Connections): void {
    const actionIds = new Set(actions.map(a => a.id));
    const connections = this.filterConnections(allConnections, actionIds);

    const clipboardData: ClipboardData = {
      actions: JSON.parse(JSON.stringify(actions)),
      connections: JSON.parse(JSON.stringify(connections)),
      timestamp: Date.now(),
      operation: 'cut',
    };

    this.state.current = clipboardData;
    this.addToHistory(clipboardData);
    this.notifyListeners();

    this.copyToSystemClipboard(clipboardData);
  }

  /**
   * Paste actions from clipboard
   */
  paste(options: PasteOptions = {}): PasteResult | null {
    if (!this.state.current) {
      return null;
    }

    const {
      offset = { x: 50, y: 50 },
      position,
      generateNewIds = true,
      preserveConnections = true,
    } = options;

    const { actions, connections } = this.state.current;

    // Calculate actual offset
    let actualOffset = offset;
    if (position && actions.length > 0) {
      const firstAction = actions[0];
      actualOffset = {
        x: position.x - firstAction.position[0],
        y: position.y - firstAction.position[1],
      };
    }

    // Clone actions with new IDs and positions
    const idMap = new Map<string, string>();
    const newActions: Action[] = [];

    for (const action of actions) {
      const newId = generateNewIds ? this.generateActionId() : action.id;
      idMap.set(action.id, newId);

      const newAction: Action = {
        ...action,
        id: newId,
        position: [
          action.position[0] + actualOffset.x,
          action.position[1] + actualOffset.y,
        ],
      };

      newActions.push(newAction);
    }

    // Update connections with new IDs
    const newConnections: Connections = preserveConnections
      ? this.updateConnectionIds(connections, idMap)
      : {};

    return {
      actions: newActions,
      connections: newConnections,
      idMap,
    };
  }

  /**
   * Duplicate: paste without consuming clipboard
   */
  duplicate(actions: Action[], allConnections: Connections, offset = { x: 50, y: 50 }): PasteResult {
    // Temporarily save current clipboard
    const savedClipboard = this.state.current;

    // Copy and paste
    this.copy(actions, allConnections);
    const result = this.paste({ offset });

    // Restore previous clipboard
    this.state.current = savedClipboard;

    return result!;
  }

  // ==========================================================================
  // Clipboard Query
  // ==========================================================================

  /**
   * Check if clipboard has data
   */
  hasData(): boolean {
    return this.state.current !== null;
  }

  /**
   * Get current clipboard data
   */
  getData(): ClipboardData | null {
    return this.state.current ? { ...this.state.current } : null;
  }

  /**
   * Get clipboard action count
   */
  getActionCount(): number {
    return this.state.current?.actions.length ?? 0;
  }

  /**
   * Check if clipboard operation was cut
   */
  isCutOperation(): boolean {
    return this.state.current?.operation === 'cut';
  }

  // ==========================================================================
  // History Management
  // ==========================================================================

  /**
   * Get clipboard history
   */
  getHistory(): ClipboardHistoryEntry[] {
    return [...this.state.history];
  }

  /**
   * Load from history
   */
  loadFromHistory(entryId: string): boolean {
    const entry = this.state.history.find(e => e.id === entryId);
    if (!entry) return false;

    this.state.current = {
      actions: entry.actions,
      connections: entry.connections,
      timestamp: entry.timestamp,
      sourceWorkflowId: entry.sourceWorkflowId,
      operation: entry.operation,
    };

    this.notifyListeners();
    return true;
  }

  /**
   * Clear clipboard
   */
  clear(): void {
    this.state.current = null;
    this.notifyListeners();
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.state.history = [];
    this.notifyListeners();
  }

  // ==========================================================================
  // System Clipboard Integration
  // ==========================================================================

  /**
   * Copy to system clipboard
   */
  private async copyToSystemClipboard(data: ClipboardData): Promise<void> {
    try {
      const text = JSON.stringify({
        type: 'qontinui-workflow-clipboard',
        version: '1.0',
        data,
      });

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch (error) {
      console.warn('Failed to copy to system clipboard:', error);
    }
  }

  /**
   * Read from system clipboard
   */
  async pasteFromSystemClipboard(): Promise<boolean> {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        return false;
      }

      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);

      if (parsed.type !== 'qontinui-workflow-clipboard') {
        return false;
      }

      this.state.current = parsed.data;
      this.notifyListeners();

      return true;
    } catch (error) {
      console.warn('Failed to read from system clipboard:', error);
      return false;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Filter connections to only include those between given actions
   */
  private filterConnections(
    allConnections: Connections,
    actionIds: Set<string>
  ): Connections {
    const filtered: Connections = {};

    for (const sourceId of actionIds) {
      const sourceConnections = allConnections[sourceId];
      if (!sourceConnections) continue;

      filtered[sourceId] = {};

      for (const [type, outputs] of Object.entries(sourceConnections)) {
        const filteredOutputs = outputs?.map(outputConnections =>
          outputConnections.filter(conn => actionIds.has(conn.action))
        );

        // Only include if there are connections
        if (filteredOutputs?.some(arr => arr.length > 0)) {
          filtered[sourceId][type] = filteredOutputs;
        }
      }

      // Remove if no connections
      if (Object.keys(filtered[sourceId]).length === 0) {
        delete filtered[sourceId];
      }
    }

    return filtered;
  }

  /**
   * Update connection IDs with new mappings
   */
  private updateConnectionIds(
    connections: Connections,
    idMap: Map<string, string>
  ): Connections {
    const updated: Connections = {};

    for (const [sourceId, sourceConnections] of Object.entries(connections)) {
      const newSourceId = idMap.get(sourceId) || sourceId;
      updated[newSourceId] = {};

      for (const [type, outputs] of Object.entries(sourceConnections)) {
        updated[newSourceId][type] = outputs?.map(outputConnections =>
          outputConnections.map(conn => ({
            ...conn,
            action: idMap.get(conn.action) || conn.action,
          }))
        );
      }
    }

    return updated;
  }

  /**
   * Generate unique action ID
   */
  private generateActionId(): string {
    return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add to history
   */
  private addToHistory(data: ClipboardData): void {
    const entry: ClipboardHistoryEntry = {
      ...data,
      id: `clipboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    this.state.history.unshift(entry);

    // Limit history size
    if (this.state.history.length > this.state.maxHistorySize) {
      this.state.history = this.state.history.slice(0, this.state.maxHistorySize);
    }
  }

  /**
   * Notify listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      listener(this.state);
    });
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Subscribe to clipboard changes
   */
  subscribe(listener: (state: ClipboardState) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current state
   */
  getState(): ClipboardState {
    return { ...this.state };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new clipboard manager instance
 */
export function createClipboardManager(maxHistorySize = 10): ClipboardManager {
  return new ClipboardManager(maxHistorySize);
}
