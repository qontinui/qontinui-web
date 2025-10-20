/**
 * Auto-Save System
 *
 * Handles automatic saving of workflows:
 * - Auto-save every N seconds (configurable, default 30s)
 * - Only save if changes detected (using workflow hash)
 * - Save to localStorage
 * - Save status indicator (saving/saved/error)
 * - Recovery from crashes
 * - Conflict resolution
 * - Version history (last 5 auto-saves)
 */

import { Workflow } from '../lib/action-schema/action-types';
import { workflowFileManager } from './workflow-file-manager';

// ============================================================================
// Types
// ============================================================================

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveConfig {
  enabled: boolean;
  interval: number; // milliseconds
  maxHistorySize: number;
  enableConflictDetection: boolean;
}

export interface SaveState {
  status: SaveStatus;
  lastSaved?: Date;
  lastError?: string;
  hasUnsavedChanges: boolean;
}

export interface AutoSaveEntry {
  workflow: Workflow;
  timestamp: string;
  hash: string;
  autoSaved: boolean;
}

export interface RecoveryInfo {
  hasRecovery: boolean;
  workflow?: Workflow;
  timestamp?: string;
  workflowId?: string;
}

// ============================================================================
// AutoSave Class
// ============================================================================

export class AutoSaveService {
  private static instance: AutoSaveService;

  private config: AutoSaveConfig = {
    enabled: true,
    interval: 30000, // 30 seconds
    maxHistorySize: 5,
    enableConflictDetection: true,
  };

  private currentWorkflow: Workflow | null = null;
  private currentHash: string | null = null;
  private saveState: SaveState = {
    status: 'idle',
    hasUnsavedChanges: false,
  };

  private autoSaveTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(state: SaveState) => void> = [];

  private constructor() {
    // Check for recovery on initialization
    this.checkForRecovery();

    // Start auto-save if enabled
    if (this.config.enabled) {
      this.start();
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AutoSaveService {
    if (!AutoSaveService.instance) {
      AutoSaveService.instance = new AutoSaveService();
    }
    return AutoSaveService.instance;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Update configuration
   */
  configure(config: Partial<AutoSaveConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    // Restart timer if interval changed
    if (wasEnabled && this.config.enabled && config.interval) {
      this.stop();
      this.start();
    }

    // Start/stop based on enabled flag
    if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && !this.config.enabled) {
      this.stop();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoSaveConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // Workflow Management
  // ==========================================================================

  /**
   * Set current workflow to auto-save
   */
  setWorkflow(workflow: Workflow | null): void {
    this.currentWorkflow = workflow;
    this.currentHash = workflow ? this.hashWorkflow(workflow) : null;
    this.updateState({ hasUnsavedChanges: false });
  }

  /**
   * Update current workflow (marks as changed)
   */
  updateWorkflow(workflow: Workflow): void {
    const newHash = this.hashWorkflow(workflow);
    const hasChanges = newHash !== this.currentHash;

    this.currentWorkflow = workflow;

    if (hasChanges) {
      this.updateState({ hasUnsavedChanges: true });
    }
  }

  /**
   * Get current workflow
   */
  getCurrentWorkflow(): Workflow | null {
    return this.currentWorkflow;
  }

  // ==========================================================================
  // Auto-Save Control
  // ==========================================================================

  /**
   * Start auto-save timer
   */
  start(): void {
    if (this.autoSaveTimer) {
      return; // Already running
    }

    this.autoSaveTimer = setInterval(() => {
      this.performAutoSave();
    }, this.config.interval);
  }

  /**
   * Stop auto-save timer
   */
  stop(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Pause auto-save temporarily
   */
  pause(): void {
    this.stop();
  }

  /**
   * Resume auto-save
   */
  resume(): void {
    this.start();
  }

  /**
   * Force immediate save
   */
  async saveNow(): Promise<boolean> {
    return this.performAutoSave();
  }

  // ==========================================================================
  // Save Operations
  // ==========================================================================

  /**
   * Perform auto-save operation
   */
  private async performAutoSave(): Promise<boolean> {
    if (!this.currentWorkflow) {
      return false;
    }

    // Check if there are changes
    const currentHash = this.hashWorkflow(this.currentWorkflow);
    if (currentHash === this.currentHash && !this.saveState.hasUnsavedChanges) {
      return false; // No changes, skip save
    }

    this.updateState({ status: 'saving' });

    try {
      // Detect conflicts
      if (this.config.enableConflictDetection) {
        const hasConflict = await this.detectConflict(this.currentWorkflow);
        if (hasConflict) {
          const resolved = await this.resolveConflict(this.currentWorkflow);
          if (!resolved) {
            throw new Error('Save conflict detected and could not be resolved');
          }
        }
      }

      // Save to localStorage
      const result = await workflowFileManager.saveWorkflow(
        this.currentWorkflow,
        this.getAutoSaveKey(this.currentWorkflow.id)
      );

      if (!result.success) {
        throw new Error(result.error || 'Save failed');
      }

      // Add to history
      await this.addToHistory(this.currentWorkflow);

      // Update state
      this.currentHash = currentHash;
      this.updateState({
        status: 'saved',
        lastSaved: new Date(),
        hasUnsavedChanges: false,
        lastError: undefined,
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.updateState({
        status: 'error',
        lastError: errorMessage,
      });
      console.error('Auto-save failed:', error);
      return false;
    }
  }

  /**
   * Save workflow with recovery information
   */
  private async saveWithRecovery(workflow: Workflow): Promise<void> {
    const recoveryData = {
      workflow,
      timestamp: new Date().toISOString(),
      hash: this.hashWorkflow(workflow),
    };

    localStorage.setItem(this.getRecoveryKey(), JSON.stringify(recoveryData));
  }

  // ==========================================================================
  // History Management
  // ==========================================================================

  /**
   * Add workflow to auto-save history
   */
  private async addToHistory(workflow: Workflow): Promise<void> {
    const history = this.getHistory(workflow.id);

    const entry: AutoSaveEntry = {
      workflow,
      timestamp: new Date().toISOString(),
      hash: this.hashWorkflow(workflow),
      autoSaved: true,
    };

    // Add to beginning
    history.unshift(entry);

    // Limit history size
    const limited = history.slice(0, this.config.maxHistorySize);

    // Save to localStorage
    localStorage.setItem(this.getHistoryKey(workflow.id), JSON.stringify(limited));
  }

  /**
   * Get auto-save history for a workflow
   */
  getHistory(workflowId: string): AutoSaveEntry[] {
    try {
      const json = localStorage.getItem(this.getHistoryKey(workflowId));
      if (!json) {
        return [];
      }
      return JSON.parse(json);
    } catch (error) {
      console.error('Failed to load history:', error);
      return [];
    }
  }

  /**
   * Clear history for a workflow
   */
  clearHistory(workflowId: string): void {
    localStorage.removeItem(this.getHistoryKey(workflowId));
  }

  /**
   * Restore from history entry
   */
  async restoreFromHistory(workflowId: string, index: number): Promise<Workflow | null> {
    const history = this.getHistory(workflowId);
    const entry = history[index];

    if (!entry) {
      return null;
    }

    return entry.workflow;
  }

  // ==========================================================================
  // Recovery
  // ==========================================================================

  /**
   * Check if there's a recovery available
   */
  checkForRecovery(): RecoveryInfo {
    try {
      const recoveryKey = this.getRecoveryKey();
      const json = localStorage.getItem(recoveryKey);

      if (!json) {
        return { hasRecovery: false };
      }

      const data = JSON.parse(json);
      return {
        hasRecovery: true,
        workflow: data.workflow,
        timestamp: data.timestamp,
        workflowId: data.workflow?.id,
      };
    } catch (error) {
      console.error('Failed to check recovery:', error);
      return { hasRecovery: false };
    }
  }

  /**
   * Recover workflow from crash
   */
  async recoverWorkflow(): Promise<Workflow | null> {
    const info = this.checkForRecovery();
    if (!info.hasRecovery || !info.workflow) {
      return null;
    }

    // Clear recovery data after successful recovery
    this.clearRecovery();

    return info.workflow;
  }

  /**
   * Clear recovery data
   */
  clearRecovery(): void {
    localStorage.removeItem(this.getRecoveryKey());
  }

  // ==========================================================================
  // Conflict Detection & Resolution
  // ==========================================================================

  /**
   * Detect if there's a save conflict
   */
  private async detectConflict(workflow: Workflow): Promise<boolean> {
    try {
      const savedKey = this.getAutoSaveKey(workflow.id);
      const result = await workflowFileManager.loadWorkflowFromStorage(savedKey);

      if (!result.success || !result.workflow) {
        return false; // No saved version, no conflict
      }

      // Check if saved version is different from our current version
      const savedHash = this.hashWorkflow(result.workflow);
      const currentHash = this.currentHash;

      return savedHash !== currentHash;
    } catch (error) {
      return false; // Error checking, assume no conflict
    }
  }

  /**
   * Resolve save conflict
   */
  private async resolveConflict(workflow: Workflow): Promise<boolean> {
    // For now, we always prefer the current version (last-write-wins)
    // In a more sophisticated system, we could:
    // - Show a conflict resolution UI
    // - Merge changes automatically
    // - Create a conflict snapshot for manual resolution

    console.warn('Save conflict detected - using current version (last-write-wins)');
    return true; // Continue with save
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Get current save state
   */
  getState(): SaveState {
    return { ...this.saveState };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Update state and notify listeners
   */
  private updateState(updates: Partial<SaveState>): void {
    this.saveState = { ...this.saveState, ...updates };
    this.notifyListeners();
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.saveState);
      } catch (error) {
        console.error('Error in auto-save listener:', error);
      }
    });
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Generate hash for workflow
   */
  private hashWorkflow(workflow: Workflow): string {
    // Simple hash based on JSON stringification
    // In production, use a proper hashing library
    const str = JSON.stringify(workflow);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get auto-save key for workflow
   */
  private getAutoSaveKey(workflowId: string): string {
    return `workflow-autosave:${workflowId}`;
  }

  /**
   * Get history key for workflow
   */
  private getHistoryKey(workflowId: string): string {
    return `workflow-history:${workflowId}`;
  }

  /**
   * Get recovery key
   */
  private getRecoveryKey(): string {
    return 'workflow-recovery';
  }

  /**
   * Clear all auto-save data
   */
  clearAll(): void {
    // Clear current state
    this.currentWorkflow = null;
    this.currentHash = null;
    this.updateState({
      status: 'idle',
      hasUnsavedChanges: false,
      lastError: undefined,
    });

    // Clear recovery
    this.clearRecovery();

    // Note: We don't clear history here, as it might be useful
  }
}

// ============================================================================
// Exports
// ============================================================================

export const autoSaveService = AutoSaveService.getInstance();
