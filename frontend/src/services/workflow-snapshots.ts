/**
 * Workflow Snapshots System
 *
 * Provides snapshot functionality for workflows:
 * - Create named snapshots (save points)
 * - List all snapshots
 * - Restore from snapshot
 * - Compare snapshots (diff view)
 * - Delete snapshots
 * - Export/import snapshots
 */

import { Workflow } from '../lib/action-schema/action-types';
import { cloneWorkflow } from '../lib/action-schema/workflow-utils';

// ============================================================================
// Types
// ============================================================================

export interface Snapshot {
  id: string;
  workflowId: string;
  name: string;
  description?: string;
  workflow: Workflow;
  timestamp: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: string[];
}

export interface SnapshotComparison {
  snapshot1: Snapshot;
  snapshot2: Snapshot;
  diff: SnapshotDiff;
  details: {
    actionsAdded: number;
    actionsRemoved: number;
    actionsModified: number;
    connectionsChanged: boolean;
    variablesChanged: boolean;
  };
}

// ============================================================================
// WorkflowSnapshotsService Class
// ============================================================================

export class WorkflowSnapshotsService {
  private static instance: WorkflowSnapshotsService;
  private snapshots: Map<string, Snapshot[]> = new Map();

  private constructor() {
    this.loadSnapshots();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowSnapshotsService {
    if (!WorkflowSnapshotsService.instance) {
      WorkflowSnapshotsService.instance = new WorkflowSnapshotsService();
    }
    return WorkflowSnapshotsService.instance;
  }

  // ==========================================================================
  // Create Snapshots
  // ==========================================================================

  /**
   * Create a snapshot of a workflow
   */
  createSnapshot(
    workflow: Workflow,
    name: string,
    description?: string,
    tags?: string[]
  ): Snapshot {
    const snapshot: Snapshot = {
      id: `snapshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workflowId: workflow.id,
      name,
      description,
      workflow: cloneWorkflow(workflow),
      timestamp: new Date().toISOString(),
      tags,
      metadata: {
        actionCount: workflow.actions.length,
        connectionCount: Object.keys(workflow.connections || {}).length,
        version: workflow.version,
      },
    };

    // Add to workflow's snapshot list
    const workflowSnapshots = this.snapshots.get(workflow.id) || [];
    workflowSnapshots.push(snapshot);
    this.snapshots.set(workflow.id, workflowSnapshots);

    // Persist
    this.saveSnapshots();

    return snapshot;
  }

  /**
   * Create auto-snapshot (for auto-save integration)
   */
  createAutoSnapshot(workflow: Workflow): Snapshot {
    return this.createSnapshot(
      workflow,
      `Auto-snapshot ${new Date().toLocaleString()}`,
      'Automatically created snapshot',
      ['auto']
    );
  }

  // ==========================================================================
  // List Snapshots
  // ==========================================================================

  /**
   * List all snapshots for a workflow
   */
  listSnapshots(workflowId: string): Snapshot[] {
    return this.snapshots.get(workflowId) || [];
  }

  /**
   * List all snapshots (across all workflows)
   */
  listAllSnapshots(): Snapshot[] {
    const all: Snapshot[] = [];
    this.snapshots.forEach((snapshots) => {
      all.push(...snapshots);
    });
    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId: string): Snapshot | undefined {
    for (const snapshots of this.snapshots.values()) {
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (snapshot) {
        return snapshot;
      }
    }
    return undefined;
  }

  /**
   * Get latest snapshot for workflow
   */
  getLatestSnapshot(workflowId: string): Snapshot | undefined {
    const snapshots = this.listSnapshots(workflowId);
    if (snapshots.length === 0) {
      return undefined;
    }
    return snapshots[snapshots.length - 1];
  }

  /**
   * Search snapshots
   */
  searchSnapshots(query: string, workflowId?: string): Snapshot[] {
    const allSnapshots = workflowId
      ? this.listSnapshots(workflowId)
      : this.listAllSnapshots();

    const search = query.toLowerCase();

    return allSnapshots.filter(
      (snapshot) =>
        snapshot.name.toLowerCase().includes(search) ||
        snapshot.description?.toLowerCase().includes(search) ||
        snapshot.tags?.some((tag) => tag.toLowerCase().includes(search))
    );
  }

  // ==========================================================================
  // Restore Snapshots
  // ==========================================================================

  /**
   * Restore workflow from snapshot
   */
  restoreSnapshot(snapshotId: string): Workflow | null {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      return null;
    }

    // Clone the workflow to ensure we don't modify the snapshot
    return cloneWorkflow(snapshot.workflow, snapshot.workflow.id);
  }

  /**
   * Create new workflow from snapshot
   */
  createWorkflowFromSnapshot(snapshotId: string, newName?: string): Workflow | null {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      return null;
    }

    // Clone with new ID
    const workflow = cloneWorkflow(snapshot.workflow);
    if (newName) {
      workflow.name = newName;
    }

    return workflow;
  }

  // ==========================================================================
  // Compare Snapshots
  // ==========================================================================

  /**
   * Compare two snapshots
   */
  compareSnapshots(snapshotId1: string, snapshotId2: string): SnapshotComparison | null {
    const snapshot1 = this.getSnapshot(snapshotId1);
    const snapshot2 = this.getSnapshot(snapshotId2);

    if (!snapshot1 || !snapshot2) {
      return null;
    }

    const workflow1 = snapshot1.workflow;
    const workflow2 = snapshot2.workflow;

    // Compare action IDs
    const ids1 = new Set(workflow1.actions.map((a) => a.id));
    const ids2 = new Set(workflow2.actions.map((a) => a.id));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];

    // Find added actions
    ids2.forEach((id) => {
      if (!ids1.has(id)) {
        added.push(id);
      }
    });

    // Find removed actions
    ids1.forEach((id) => {
      if (!ids2.has(id)) {
        removed.push(id);
      }
    });

    // Find modified and unchanged actions
    ids1.forEach((id) => {
      if (ids2.has(id)) {
        const action1 = workflow1.actions.find((a) => a.id === id);
        const action2 = workflow2.actions.find((a) => a.id === id);

        if (action1 && action2) {
          const hash1 = this.hashAction(action1);
          const hash2 = this.hashAction(action2);

          if (hash1 === hash2) {
            unchanged.push(id);
          } else {
            modified.push(id);
          }
        }
      }
    });

    // Check connections changes
    const connectionsChanged =
      JSON.stringify(workflow1.connections) !== JSON.stringify(workflow2.connections);

    // Check variables changes
    const variablesChanged =
      JSON.stringify(workflow1.variables) !== JSON.stringify(workflow2.variables);

    return {
      snapshot1,
      snapshot2,
      diff: {
        added,
        removed,
        modified,
        unchanged,
      },
      details: {
        actionsAdded: added.length,
        actionsRemoved: removed.length,
        actionsModified: modified.length,
        connectionsChanged,
        variablesChanged,
      },
    };
  }

  /**
   * Compare workflow with latest snapshot
   */
  compareWithLatest(workflow: Workflow): SnapshotComparison | null {
    const latestSnapshot = this.getLatestSnapshot(workflow.id);
    if (!latestSnapshot) {
      return null;
    }

    // Create temporary snapshot for current workflow
    const currentSnapshot: Snapshot = {
      id: 'temp',
      workflowId: workflow.id,
      name: 'Current',
      workflow,
      timestamp: new Date().toISOString(),
    };

    // Compare
    return {
      snapshot1: latestSnapshot,
      snapshot2: currentSnapshot,
      diff: this.calculateDiff(latestSnapshot.workflow, workflow),
      details: this.calculateDetails(latestSnapshot.workflow, workflow),
    };
  }

  // ==========================================================================
  // Delete Snapshots
  // ==========================================================================

  /**
   * Delete a snapshot
   */
  deleteSnapshot(snapshotId: string): boolean {
    for (const [workflowId, snapshots] of this.snapshots.entries()) {
      const index = snapshots.findIndex((s) => s.id === snapshotId);
      if (index !== -1) {
        snapshots.splice(index, 1);
        this.snapshots.set(workflowId, snapshots);
        this.saveSnapshots();
        return true;
      }
    }
    return false;
  }

  /**
   * Delete all snapshots for a workflow
   */
  deleteWorkflowSnapshots(workflowId: string): number {
    const snapshots = this.snapshots.get(workflowId) || [];
    const count = snapshots.length;
    this.snapshots.delete(workflowId);
    this.saveSnapshots();
    return count;
  }

  /**
   * Delete old snapshots (keep last N)
   */
  deleteOldSnapshots(workflowId: string, keepCount: number): number {
    const snapshots = this.listSnapshots(workflowId);
    if (snapshots.length <= keepCount) {
      return 0;
    }

    const toKeep = snapshots.slice(-keepCount);
    this.snapshots.set(workflowId, toKeep);
    this.saveSnapshots();

    return snapshots.length - keepCount;
  }

  // ==========================================================================
  // Export/Import
  // ==========================================================================

  /**
   * Export snapshot as JSON
   */
  exportSnapshot(snapshotId: string): string | null {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      return null;
    }

    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Export all snapshots for a workflow
   */
  exportWorkflowSnapshots(workflowId: string): string | null {
    const snapshots = this.listSnapshots(workflowId);
    if (snapshots.length === 0) {
      return null;
    }

    return JSON.stringify(snapshots, null, 2);
  }

  /**
   * Import snapshot from JSON
   */
  importSnapshot(json: string): Snapshot | null {
    try {
      const snapshot = JSON.parse(json) as Snapshot;

      // Validate
      if (!snapshot.id || !snapshot.workflowId || !snapshot.workflow) {
        return null;
      }

      // Add to snapshots
      const workflowSnapshots = this.snapshots.get(snapshot.workflowId) || [];
      workflowSnapshots.push(snapshot);
      this.snapshots.set(snapshot.workflowId, workflowSnapshots);

      this.saveSnapshots();

      return snapshot;
    } catch (error) {
      console.error('Failed to import snapshot:', error);
      return null;
    }
  }

  /**
   * Import multiple snapshots
   */
  importSnapshots(json: string): Snapshot[] {
    try {
      const snapshots = JSON.parse(json) as Snapshot[];
      const imported: Snapshot[] = [];

      snapshots.forEach((snapshot) => {
        if (snapshot.id && snapshot.workflowId && snapshot.workflow) {
          const workflowSnapshots = this.snapshots.get(snapshot.workflowId) || [];
          workflowSnapshots.push(snapshot);
          this.snapshots.set(snapshot.workflowId, workflowSnapshots);
          imported.push(snapshot);
        }
      });

      if (imported.length > 0) {
        this.saveSnapshots();
      }

      return imported;
    } catch (error) {
      console.error('Failed to import snapshots:', error);
      return [];
    }
  }

  // ==========================================================================
  // Update Snapshots
  // ==========================================================================

  /**
   * Update snapshot metadata
   */
  updateSnapshot(
    snapshotId: string,
    updates: {
      name?: string;
      description?: string;
      tags?: string[];
    }
  ): boolean {
    for (const snapshots of this.snapshots.values()) {
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (snapshot) {
        if (updates.name) snapshot.name = updates.name;
        if (updates.description !== undefined) snapshot.description = updates.description;
        if (updates.tags) snapshot.tags = updates.tags;

        this.saveSnapshots();
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load snapshots from localStorage
   */
  private loadSnapshots(): void {
    try {
      const json = localStorage.getItem('workflow-snapshots');
      if (json) {
        const data = JSON.parse(json);
        this.snapshots = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error('Failed to load snapshots:', error);
      this.snapshots = new Map();
    }
  }

  /**
   * Save snapshots to localStorage
   */
  private saveSnapshots(): void {
    try {
      const data = Object.fromEntries(this.snapshots);
      localStorage.setItem('workflow-snapshots', JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save snapshots:', error);
    }
  }

  /**
   * Clear all snapshots
   */
  clearAll(): void {
    this.snapshots.clear();
    localStorage.removeItem('workflow-snapshots');
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Hash an action for comparison
   */
  private hashAction(action: any): string {
    const str = JSON.stringify({
      type: action.type,
      config: action.config,
      position: action.position,
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Calculate diff between two workflows
   */
  private calculateDiff(workflow1: Workflow, workflow2: Workflow): SnapshotDiff {
    const ids1 = new Set(workflow1.actions.map((a) => a.id));
    const ids2 = new Set(workflow2.actions.map((a) => a.id));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];

    ids2.forEach((id) => {
      if (!ids1.has(id)) added.push(id);
    });

    ids1.forEach((id) => {
      if (!ids2.has(id)) removed.push(id);
    });

    ids1.forEach((id) => {
      if (ids2.has(id)) {
        const action1 = workflow1.actions.find((a) => a.id === id);
        const action2 = workflow2.actions.find((a) => a.id === id);

        if (action1 && action2) {
          if (this.hashAction(action1) === this.hashAction(action2)) {
            unchanged.push(id);
          } else {
            modified.push(id);
          }
        }
      }
    });

    return { added, removed, modified, unchanged };
  }

  /**
   * Calculate comparison details
   */
  private calculateDetails(
    workflow1: Workflow,
    workflow2: Workflow
  ): SnapshotComparison['details'] {
    const diff = this.calculateDiff(workflow1, workflow2);

    return {
      actionsAdded: diff.added.length,
      actionsRemoved: diff.removed.length,
      actionsModified: diff.modified.length,
      connectionsChanged:
        JSON.stringify(workflow1.connections) !== JSON.stringify(workflow2.connections),
      variablesChanged:
        JSON.stringify(workflow1.variables) !== JSON.stringify(workflow2.variables),
    };
  }

  /**
   * Get snapshot count
   */
  getSnapshotCount(workflowId?: string): number {
    if (workflowId) {
      return this.listSnapshots(workflowId).length;
    }
    return this.listAllSnapshots().length;
  }

  /**
   * Check if snapshot exists
   */
  hasSnapshot(snapshotId: string): boolean {
    return this.getSnapshot(snapshotId) !== undefined;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowSnapshots = WorkflowSnapshotsService.getInstance();
