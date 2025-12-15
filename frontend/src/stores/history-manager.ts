/**
 * History Manager - Undo/Redo functionality for canvas state
 *
 * Features:
 * - Undo/redo stack management
 * - History size limits (default 50)
 * - Debounced history recording
 * - History serialization
 * - Action grouping (batch operations as single undo)
 * - Time-travel debugging support
 */

import type { Workflow } from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface HistoryEntry {
  /** Unique identifier for this history entry */
  id: string;

  /** The workflow state at this point in time */
  workflow: Workflow;

  /** Timestamp when this entry was created */
  timestamp: number;

  /** Optional description of what changed */
  description?: string;

  /** Type of operation that caused this entry */
  operationType?:
    | "add"
    | "update"
    | "delete"
    | "move"
    | "connect"
    | "batch"
    | "other";

  /** User-defined metadata */
  metadata?: Record<string, unknown>;
}

export interface HistoryManagerConfig {
  /** Maximum number of history entries to keep */
  maxSize: number;

  /** Debounce delay for recording history (ms) */
  debounceDelay: number;

  /** Enable compression for stored workflows */
  enableCompression: boolean;

  /** Enable time-travel debugging */
  enableTimeTravel: boolean;
}

export interface HistoryState {
  /** Stack of history entries */
  entries: HistoryEntry[];

  /** Current position in the history stack */
  currentIndex: number;

  /** Whether we're currently in a batch operation */
  inBatch: boolean;

  /** Batch description for grouped operations */
  batchDescription?: string;

  /** Pending debounced history record */
  pendingRecord?: {
    workflow: Workflow;
    description?: string;
    operationType?: HistoryEntry["operationType"];
  };
}

// ============================================================================
// History Manager Class
// ============================================================================

export class HistoryManager {
  private state: HistoryState;
  private config: HistoryManagerConfig;
  private debounceTimer: NodeJS.Timeout | null = null;
  private listeners: Set<(state: HistoryState) => void> = new Set();

  constructor(config: Partial<HistoryManagerConfig> = {}) {
    this.config = {
      maxSize: config.maxSize ?? 50,
      debounceDelay: config.debounceDelay ?? 300,
      enableCompression: config.enableCompression ?? false,
      enableTimeTravel: config.enableTimeTravel ?? false,
    };

    this.state = {
      entries: [],
      currentIndex: -1,
      inBatch: false,
    };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Record a new history entry
   */
  record(
    workflow: Workflow,
    description?: string,
    operationType?: HistoryEntry["operationType"]
  ): void {
    if (this.state.inBatch) {
      // In batch mode, just update the pending record
      this.state.pendingRecord = { workflow, description, operationType };
      return;
    }

    // Debounce history recording
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.state.pendingRecord = { workflow, description, operationType };

    this.debounceTimer = setTimeout(() => {
      this.flushPendingRecord();
    }, this.config.debounceDelay);
  }

  /**
   * Record immediately without debouncing
   */
  recordImmediate(
    workflow: Workflow,
    description?: string,
    operationType?: HistoryEntry["operationType"]
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.addEntry(workflow, description, operationType);
  }

  /**
   * Start a batch operation
   */
  startBatch(description?: string): void {
    this.state.inBatch = true;
    this.state.batchDescription = description;
  }

  /**
   * End a batch operation and record as single entry
   */
  endBatch(): void {
    if (!this.state.inBatch) return;

    this.state.inBatch = false;

    if (this.state.pendingRecord) {
      this.addEntry(
        this.state.pendingRecord.workflow,
        this.state.batchDescription || this.state.pendingRecord.description,
        "batch"
      );
    }

    this.state.batchDescription = undefined;
    this.state.pendingRecord = undefined;
  }

  /**
   * Undo to previous state
   */
  undo(): HistoryEntry | null {
    if (!this.canUndo()) return null;

    this.state.currentIndex--;
    const entry = this.state.entries[this.state.currentIndex];
    this.notifyListeners();

    return entry ?? null;
  }

  /**
   * Redo to next state
   */
  redo(): HistoryEntry | null {
    if (!this.canRedo()) return null;

    this.state.currentIndex++;
    const entry = this.state.entries[this.state.currentIndex];
    this.notifyListeners();

    return entry ?? null;
  }

  /**
   * Jump to a specific history entry
   */
  jumpTo(index: number): HistoryEntry | null {
    if (index < 0 || index >= this.state.entries.length) {
      return null;
    }

    this.state.currentIndex = index;
    const entry = this.state.entries[index];
    this.notifyListeners();

    return entry ?? null;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.state.currentIndex > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.state.currentIndex < this.state.entries.length - 1;
  }

  /**
   * Get current workflow state
   */
  getCurrentState(): HistoryEntry | null {
    if (this.state.currentIndex < 0) return null;
    return this.state.entries[this.state.currentIndex] ?? null;
  }

  /**
   * Get all history entries
   */
  getHistory(): HistoryEntry[] {
    return [...this.state.entries];
  }

  /**
   * Get current index
   */
  getCurrentIndex(): number {
    return this.state.currentIndex;
  }

  /**
   * Clear all history
   */
  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.state = {
      entries: [],
      currentIndex: -1,
      inBatch: false,
    };

    this.notifyListeners();
  }

  /**
   * Get history statistics
   */
  getStats(): {
    totalEntries: number;
    currentIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    memoryUsage: number;
  } {
    const memoryUsage = this.calculateMemoryUsage();

    return {
      totalEntries: this.state.entries.length,
      currentIndex: this.state.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      memoryUsage,
    };
  }

  /**
   * Export history to JSON
   */
  export(): string {
    return JSON.stringify({
      entries: this.state.entries,
      currentIndex: this.state.currentIndex,
      exportedAt: new Date().toISOString(),
    });
  }

  /**
   * Import history from JSON
   */
  import(json: string): boolean {
    try {
      const data = JSON.parse(json);

      if (!Array.isArray(data.entries)) {
        throw new Error("Invalid history format");
      }

      this.state.entries = data.entries;
      this.state.currentIndex = data.currentIndex ?? data.entries.length - 1;
      this.notifyListeners();

      return true;
    } catch (error) {
      console.error("Failed to import history:", error);
      return false;
    }
  }

  /**
   * Subscribe to history changes
   */
  subscribe(listener: (state: HistoryState) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private flushPendingRecord(): void {
    if (!this.state.pendingRecord) return;

    const { workflow, description, operationType } = this.state.pendingRecord;
    this.addEntry(workflow, description, operationType);

    this.state.pendingRecord = undefined;
    this.debounceTimer = null;
  }

  private addEntry(
    workflow: Workflow,
    description?: string,
    operationType?: HistoryEntry["operationType"]
  ): void {
    // Clone workflow to avoid reference issues
    const workflowClone = JSON.parse(JSON.stringify(workflow));

    const entry: HistoryEntry = {
      id: `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workflow: workflowClone,
      timestamp: Date.now(),
      description,
      operationType,
    };

    // Remove any entries after current index (if user made changes after undo)
    const newEntries = this.state.entries.slice(0, this.state.currentIndex + 1);

    // Add new entry
    newEntries.push(entry);

    // Limit history size
    if (newEntries.length > this.config.maxSize) {
      newEntries.shift();
    } else {
      this.state.currentIndex++;
    }

    this.state.entries = newEntries;
    this.notifyListeners();
  }

  private calculateMemoryUsage(): number {
    // Rough estimate of memory usage in bytes
    const json = JSON.stringify(this.state.entries);
    return new Blob([json]).size;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      listener(this.state);
    });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new history manager instance
 */
export function createHistoryManager(
  config?: Partial<HistoryManagerConfig>
): HistoryManager {
  return new HistoryManager(config);
}

/**
 * Create a history manager with time-travel debugging enabled
 */
export function createTimeTravelHistoryManager(): HistoryManager {
  return new HistoryManager({
    maxSize: 100,
    debounceDelay: 0,
    enableTimeTravel: true,
  });
}
