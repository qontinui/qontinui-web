/**
 * Workflow Version Control System
 *
 * Provides git-like version control for workflows with:
 * - Branch management (create, delete, switch, merge branches)
 * - Version management (save versions, rollback, history)
 * - Tagging (mark important versions with tags)
 * - Diff & Compare (detailed structural diffs)
 * - Merge operations (with conflict detection)
 * - Change tracking (detect and summarize changes)
 * - Visual diff support (for UI rendering)
 * - Import/Export (backup and restore)
 * - Integration with existing snapshots
 */

import type { Workflow } from "../../lib/action-schema/action-types";
import { Snapshot, WorkflowSnapshotsService } from "../workflow-snapshots";

// Re-export all types
export type {
  Branch,
  Version,
  Tag,
  VersionDiff,
  ActionDiff,
  ActionModification,
  ConnectionDiff,
  ConnectionModification,
  PropertyChange,
  VariableChange,
  DiffSummary,
  MergeConflict,
  MergeResult,
  ConflictResolution,
  ChangeSummary,
  ChangeStatistics,
  Contributor,
} from "./types";

// Re-export sub-modules
export { BranchManager } from "./branch-manager";
export { VersionManager } from "./version-manager";
export { TagManager } from "./tag-manager";
export { MergeEngine } from "./merge-engine";
export { getDiff, summarizeChanges } from "./diff-engine";
export { loadData, saveData, clearStorageData } from "./persistence";

// Import for internal use
import type {
  Branch,
  Version,
  Tag,
  VersionDiff,
  ActionDiff,
  ActionModification,
  ConnectionDiff,
  ConnectionModification,
  MergeConflict,
  MergeResult,
  ConflictResolution,
  ChangeSummary,
  ChangeStatistics,
  Contributor,
} from "./types";
import { BranchManager } from "./branch-manager";
import { VersionManager } from "./version-manager";
import { TagManager } from "./tag-manager";
import { MergeEngine } from "./merge-engine";
import { getDiff } from "./diff-engine";
import {
  loadData,
  saveData as persistSaveData,
  clearStorageData,
} from "./persistence";
import { createLogger } from "@/lib/logger";
const logger = createLogger("WorkflowVersionControl");

// ============================================================================
// WorkflowVersionControl Service Class (Facade)
// ============================================================================

export class WorkflowVersionControl {
  private static instance: WorkflowVersionControl;

  private branches: Map<string, Branch[]> = new Map();
  private versions: Map<string, Version[]> = new Map();
  private tags: Map<string, Tag[]> = new Map();
  private currentBranch: Map<string, string> = new Map();

  private branchMgr: BranchManager;
  private versionMgr: VersionManager;
  private tagMgr: TagManager;
  private mergeEng: MergeEngine;

  private constructor() {
    const data = loadData();
    this.branches = data.branches;
    this.versions = data.versions;
    this.tags = data.tags;
    this.currentBranch = data.currentBranch;

    const generateId = this.generateId.bind(this);
    const saveDataFn = this.saveData.bind(this);

    this.branchMgr = new BranchManager(
      this.branches,
      this.versions,
      this.tags,
      this.currentBranch,
      generateId,
      saveDataFn
    );

    this.versionMgr = new VersionManager(
      this.versions,
      this.branchMgr,
      generateId,
      saveDataFn
    );

    this.tagMgr = new TagManager(
      this.tags,
      (versionId: string) => this.versionMgr.getVersion(versionId),
      generateId,
      saveDataFn
    );

    this.mergeEng = new MergeEngine(
      this.branchMgr,
      this.versionMgr,
      generateId
    );
  }

  static getInstance(): WorkflowVersionControl {
    if (!WorkflowVersionControl.instance) {
      WorkflowVersionControl.instance = new WorkflowVersionControl();
    }
    return WorkflowVersionControl.instance;
  }

  // ==========================================================================
  // Branch Management (delegates to BranchManager)
  // ==========================================================================

  createBranch(
    workflowId: string,
    branchName: string,
    fromBranchId?: string,
    description?: string
  ): Branch {
    return this.branchMgr.createBranch(
      workflowId,
      branchName,
      fromBranchId,
      description
    );
  }

  deleteBranch(branchId: string): boolean {
    return this.branchMgr.deleteBranch(branchId);
  }

  getBranch(branchId: string): Branch | undefined {
    return this.branchMgr.getBranch(branchId);
  }

  getAllBranches(workflowId: string): Branch[] {
    return this.branchMgr.getAllBranches(workflowId);
  }

  switchBranch(workflowId: string, branchId: string): Branch {
    return this.branchMgr.switchBranch(workflowId, branchId);
  }

  getCurrentBranch(workflowId: string): Branch | undefined {
    return this.branchMgr.getCurrentBranch(workflowId);
  }

  // ==========================================================================
  // Version Management (delegates to VersionManager)
  // ==========================================================================

  saveVersion(
    workflowId: string,
    branchId: string,
    workflow: Workflow,
    message: string,
    author?: string
  ): Version {
    return this.versionMgr.saveVersion(
      workflowId,
      branchId,
      workflow,
      message,
      author
    );
  }

  getVersion(versionId: string): Version | undefined {
    return this.versionMgr.getVersion(versionId);
  }

  getVersionHistory(workflowId: string, branchId?: string): Version[] {
    return this.versionMgr.getVersionHistory(workflowId, branchId);
  }

  getAllVersions(workflowId: string): Version[] {
    return this.versionMgr.getAllVersions(workflowId);
  }

  rollbackToVersion(
    workflowId: string,
    versionId: string,
    author?: string
  ): Version {
    return this.versionMgr.rollbackToVersion(workflowId, versionId, author);
  }

  getLatestVersion(workflowId: string, branchId?: string): Version | undefined {
    return this.versionMgr.getLatestVersion(workflowId, branchId);
  }

  // ==========================================================================
  // Tagging (delegates to TagManager)
  // ==========================================================================

  createTag(
    workflowId: string,
    versionId: string,
    tagName: string,
    description?: string
  ): Tag {
    return this.tagMgr.createTag(workflowId, versionId, tagName, description);
  }

  deleteTag(tagId: string): boolean {
    return this.tagMgr.deleteTag(tagId);
  }

  getTag(tagId: string): Tag | undefined {
    return this.tagMgr.getTag(tagId);
  }

  getAllTags(workflowId: string): Tag[] {
    return this.tagMgr.getAllTags(workflowId);
  }

  getVersionByTag(workflowId: string, tagName: string): Version | undefined {
    return this.tagMgr.getVersionByTag(workflowId, tagName);
  }

  // ==========================================================================
  // Diff & Compare (delegates to VersionManager)
  // ==========================================================================

  compareVersions(version1Id: string, version2Id: string): VersionDiff | null {
    return this.versionMgr.compareVersions(version1Id, version2Id);
  }

  compareWorkflows(workflow1: Workflow, workflow2: Workflow): VersionDiff {
    return this.versionMgr.compareWorkflows(workflow1, workflow2);
  }

  getDiff(workflow1: Workflow, workflow2: Workflow): VersionDiff {
    return getDiff(workflow1, workflow2);
  }

  // ==========================================================================
  // Merge Operations (delegates to MergeEngine)
  // ==========================================================================

  mergeBranch(
    sourceBranchId: string,
    targetBranchId: string,
    author?: string
  ): MergeResult {
    return this.mergeEng.mergeBranch(sourceBranchId, targetBranchId, author);
  }

  detectConflicts(
    sourceBranchId: string,
    targetBranchId: string
  ): MergeConflict[] {
    return this.mergeEng.detectConflicts(sourceBranchId, targetBranchId);
  }

  resolveMergeConflict(
    _conflictId: string,
    _resolution: ConflictResolution
  ): boolean {
    return this.mergeEng.resolveMergeConflict(_conflictId, _resolution);
  }

  autoMerge(
    sourceBranchId: string,
    targetBranchId: string,
    author?: string
  ): MergeResult {
    return this.mergeEng.autoMerge(sourceBranchId, targetBranchId, author);
  }

  getConflicts(
    sourceBranchId: string,
    targetBranchId: string
  ): MergeConflict[] {
    return this.mergeEng.getConflicts(sourceBranchId, targetBranchId);
  }

  // ==========================================================================
  // Change Tracking (delegates to VersionManager)
  // ==========================================================================

  detectChanges(
    originalWorkflow: Workflow,
    currentWorkflow: Workflow
  ): VersionDiff {
    return this.versionMgr.detectChanges(originalWorkflow, currentWorkflow);
  }

  summarizeChanges(changes: VersionDiff): ChangeSummary {
    return this.versionMgr.summarizeChanges(changes);
  }

  getChangeStatistics(workflowId: string): ChangeStatistics {
    return this.versionMgr.getChangeStatistics(workflowId);
  }

  getContributors(workflowId: string): Contributor[] {
    return this.versionMgr.getContributors(workflowId);
  }

  // ==========================================================================
  // Visual Diff (delegates to VersionManager)
  // ==========================================================================

  generateVisualDiff(
    version1Id: string,
    version2Id: string
  ): VersionDiff | null {
    return this.versionMgr.generateVisualDiff(version1Id, version2Id);
  }

  getAddedNodes(diff: VersionDiff): ActionDiff[] {
    return this.versionMgr.getAddedNodes(diff);
  }

  getRemovedNodes(diff: VersionDiff): ActionDiff[] {
    return this.versionMgr.getRemovedNodes(diff);
  }

  getModifiedNodes(diff: VersionDiff): ActionModification[] {
    return this.versionMgr.getModifiedNodes(diff);
  }

  getConnectionChanges(diff: VersionDiff): {
    added: ConnectionDiff[];
    removed: ConnectionDiff[];
    modified: ConnectionModification[];
  } {
    return this.versionMgr.getConnectionChanges(diff);
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  exportBranch(branchId: string): string | null {
    const branch = this.getBranch(branchId);
    if (!branch) return null;

    const versions = this.getVersionHistory(branch.workflowId, branchId);
    const tags = this.getAllTags(branch.workflowId).filter((t) =>
      versions.some((v) => v.id === t.versionId)
    );

    const exportData = {
      branch,
      versions,
      tags,
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  importBranch(json: string): Branch | null {
    try {
      const data = JSON.parse(json);

      if (!data.branch || !data.versions) {
        return null;
      }

      const branch = data.branch as Branch;
      const versions = data.versions as Version[];
      const tags = (data.tags as Tag[]) || [];

      // Add branch
      const branches = this.branches.get(branch.workflowId) || [];
      branches.push(branch);
      this.branches.set(branch.workflowId, branches);

      // Add versions
      const existingVersions = this.versions.get(branch.workflowId) || [];
      existingVersions.push(...versions);
      this.versions.set(branch.workflowId, existingVersions);

      // Add tags
      if (tags.length > 0) {
        const existingTags = this.tags.get(branch.workflowId) || [];
        existingTags.push(...tags);
        this.tags.set(branch.workflowId, existingTags);
      }

      this.saveData();
      return branch;
    } catch (error) {
      logger.error("Failed to import branch:", error);
      return null;
    }
  }

  exportVersionHistory(workflowId: string): string | null {
    const branches = this.getAllBranches(workflowId);
    const versions = this.getAllVersions(workflowId);
    const tags = this.getAllTags(workflowId);

    if (branches.length === 0 && versions.length === 0) {
      return null;
    }

    const exportData = {
      workflowId,
      branches,
      versions,
      tags,
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  importVersionHistory(json: string): boolean {
    try {
      const data = JSON.parse(json);

      if (!data.workflowId || !data.branches || !data.versions) {
        return false;
      }

      const workflowId = data.workflowId;

      this.branches.set(workflowId, data.branches);
      this.versions.set(workflowId, data.versions);
      if (data.tags) {
        this.tags.set(workflowId, data.tags);
      }

      this.saveData();
      return true;
    } catch (error) {
      logger.error("Failed to import version history:", error);
      return false;
    }
  }

  // ==========================================================================
  // Integration with Snapshots
  // ==========================================================================

  migrateSnapshots(): number {
    const snapshotService = WorkflowSnapshotsService.getInstance();
    const allSnapshots = snapshotService.listAllSnapshots();

    let migrated = 0;

    // Group snapshots by workflow
    const snapshotsByWorkflow = new Map<string, Snapshot[]>();
    allSnapshots.forEach((snapshot) => {
      const snapshots = snapshotsByWorkflow.get(snapshot.workflowId) || [];
      snapshots.push(snapshot);
      snapshotsByWorkflow.set(snapshot.workflowId, snapshots);
    });

    // Create branches and versions for each workflow
    const workflowIds = Array.from(snapshotsByWorkflow.keys());
    for (const workflowId of workflowIds) {
      const snapshots = snapshotsByWorkflow.get(workflowId);
      if (!snapshots) continue;

      // Create main branch if doesn't exist
      let branches = this.getAllBranches(workflowId);
      if (branches.length === 0) {
        this.createBranch(
          workflowId,
          "main",
          undefined,
          "Migrated from snapshots"
        );
        branches = this.getAllBranches(workflowId);
      }

      const mainBranch = branches[0];
      if (!mainBranch) continue;

      const mainBranchId = mainBranch.id;

      // Convert each snapshot to a version
      const sortedSnapshots = snapshots.sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp)
      );
      for (const snapshot of sortedSnapshots) {
        const author =
          snapshot.metadata?.author &&
          typeof snapshot.metadata.author === "string"
            ? snapshot.metadata.author
            : undefined;
        this.saveVersion(
          workflowId,
          mainBranchId,
          snapshot.workflow,
          snapshot.name,
          author
        );
        migrated++;
      }
    }

    return migrated;
  }

  createVersionFromSnapshot(
    snapshotId: string,
    branchId?: string
  ): Version | null {
    const snapshotService = WorkflowSnapshotsService.getInstance();
    const snapshot = snapshotService.getSnapshot(snapshotId);

    if (!snapshot) {
      return null;
    }

    // Get or create branch
    let targetBranchId = branchId;
    if (!targetBranchId) {
      const branches = this.getAllBranches(snapshot.workflowId);
      if (branches.length === 0) {
        const branch = this.createBranch(snapshot.workflowId, "main");
        targetBranchId = branch.id;
      } else {
        const firstBranch = branches[0];
        targetBranchId =
          firstBranch?.id ?? this.createBranch(snapshot.workflowId, "main").id;
      }
    }

    const author =
      snapshot.metadata?.author && typeof snapshot.metadata.author === "string"
        ? snapshot.metadata.author
        : undefined;
    return this.saveVersion(
      snapshot.workflowId,
      targetBranchId,
      snapshot.workflow,
      snapshot.name,
      author
    );
  }

  // ==========================================================================
  // Persistence & Cleanup
  // ==========================================================================

  clearAll(workflowId?: string): void {
    if (workflowId) {
      this.branches.delete(workflowId);
      this.versions.delete(workflowId);
      this.tags.delete(workflowId);
      this.currentBranch.delete(workflowId);
    } else {
      this.branches.clear();
      this.versions.clear();
      this.tags.clear();
      this.currentBranch.clear();
      clearStorageData();
    }
    this.saveData();
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private saveData(): void {
    persistSaveData({
      branches: this.branches,
      versions: this.versions,
      tags: this.tags,
      currentBranch: this.currentBranch,
    });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const workflowVersionControl = WorkflowVersionControl.getInstance();
