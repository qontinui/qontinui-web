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

import {
  Workflow,
  Action,
  Connections,
  Connection,
} from "../lib/action-schema/action-types";
import { cloneWorkflow } from "../lib/action-schema/workflow-utils";
import { Snapshot, WorkflowSnapshotsService } from "./workflow-snapshots";

// ============================================================================
// Types
// ============================================================================

/**
 * Branch represents a line of development for a workflow
 */
export interface Branch {
  id: string;
  workflowId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  parentBranchId?: string;
  currentVersionId?: string;
  isDefault?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Version represents a saved state of a workflow (like a commit)
 */
export interface Version {
  id: string;
  workflowId: string;
  branchId: string;
  workflow: Workflow;
  message: string;
  author?: string;
  timestamp: string;
  parentVersionId?: string;
  tags?: string[];
  metadata?: {
    actionCount: number;
    connectionCount: number;
    changesSummary?: ChangeSummary;
    [key: string]: any;
  };
}

/**
 * Tag marks an important version
 */
export interface Tag {
  id: string;
  workflowId: string;
  versionId: string;
  name: string;
  description?: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

/**
 * Detailed diff between two workflows
 */
export interface VersionDiff {
  // Action changes
  actionsAdded: ActionDiff[];
  actionsRemoved: ActionDiff[];
  actionsModified: ActionModification[];
  actionsUnchanged: string[];

  // Connection changes
  connectionsAdded: ConnectionDiff[];
  connectionsRemoved: ConnectionDiff[];
  connectionsModified: ConnectionModification[];

  // Workflow property changes
  propertiesChanged: PropertyChange[];

  // Variable changes
  variablesChanged: VariableChange[];

  // Summary statistics
  summary: DiffSummary;
}

export interface ActionDiff {
  id: string;
  type: string;
  name?: string;
  position: [number, number];
  config: any;
}

export interface ActionModification {
  id: string;
  changes: {
    type?: { old: string; new: string };
    name?: { old?: string; new?: string };
    config?: { old: any; new: any; fields: string[] };
    position?: { old: [number, number]; new: [number, number] };
    base?: { old?: any; new?: any };
    execution?: { old?: any; new?: any };
  };
}

export interface ConnectionDiff {
  source: string;
  target: string;
  type: "main" | "error" | "success" | "parallel";
  outputIndex: number;
  inputIndex: number;
}

export interface ConnectionModification {
  source: string;
  oldTarget: string;
  newTarget: string;
  type: "main" | "error" | "success" | "parallel";
}

export interface PropertyChange {
  property: string;
  oldValue: any;
  newValue: any;
}

export interface VariableChange {
  scope: "local" | "process" | "global";
  key: string;
  oldValue?: any;
  newValue?: any;
  type: "added" | "removed" | "modified";
}

export interface DiffSummary {
  actionsAdded: number;
  actionsRemoved: number;
  actionsModified: number;
  connectionsChanged: number;
  propertiesChanged: number;
  variablesChanged: number;
  totalChanges: number;
}

/**
 * Merge conflict information
 */
export interface MergeConflict {
  id: string;
  type: "action" | "connection" | "property" | "variable";
  path: string;
  sourceValue: any;
  targetValue: any;
  baseValue?: any;
  description: string;
}

export interface MergeResult {
  success: boolean;
  workflow?: Workflow;
  conflicts: MergeConflict[];
  message: string;
}

export interface ConflictResolution {
  conflictId: string;
  resolution: "source" | "target" | "manual";
  value?: any;
}

/**
 * Change tracking
 */
export interface ChangeSummary {
  actionsAdded: number;
  actionsRemoved: number;
  actionsModified: number;
  connectionsChanged: number;
  propertiesChanged: string[];
  hasStructuralChanges: boolean;
  hasConfigChanges: boolean;
}

export interface ChangeStatistics {
  totalVersions: number;
  totalChanges: number;
  averageChangesPerVersion: number;
  mostActiveAreas: string[];
  changeFrequency: {
    actions: number;
    connections: number;
    properties: number;
    variables: number;
  };
}

export interface Contributor {
  author: string;
  versionCount: number;
  lastContribution: string;
  areasModified: string[];
}

// ============================================================================
// WorkflowVersionControl Service Class
// ============================================================================

export class WorkflowVersionControl {
  private static instance: WorkflowVersionControl;

  private branches: Map<string, Branch[]> = new Map();
  private versions: Map<string, Version[]> = new Map();
  private tags: Map<string, Tag[]> = new Map();
  private currentBranch: Map<string, string> = new Map();

  private constructor() {
    this.loadData();
  }

  static getInstance(): WorkflowVersionControl {
    if (!WorkflowVersionControl.instance) {
      WorkflowVersionControl.instance = new WorkflowVersionControl();
    }
    return WorkflowVersionControl.instance;
  }

  // ==========================================================================
  // Branch Management
  // ==========================================================================

  /**
   * Create a new branch
   */
  createBranch(
    workflowId: string,
    branchName: string,
    fromBranchId?: string,
    description?: string
  ): Branch {
    const branches = this.branches.get(workflowId) || [];

    // Check if branch name already exists
    if (branches.some((b) => b.name === branchName)) {
      throw new Error(`Branch "${branchName}" already exists`);
    }

    // Get parent branch and its current version
    let parentBranch: Branch | undefined;
    let currentVersionId: string | undefined;

    if (fromBranchId) {
      parentBranch = branches.find((b) => b.id === fromBranchId);
      if (!parentBranch) {
        throw new Error(`Parent branch not found: ${fromBranchId}`);
      }
      currentVersionId = parentBranch.currentVersionId;
    } else {
      // Use default branch if exists
      parentBranch = branches.find((b) => b.isDefault);
      currentVersionId = parentBranch?.currentVersionId;
    }

    const branch: Branch = {
      id: this.generateId("branch"),
      workflowId,
      name: branchName,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentBranchId: parentBranch?.id,
      currentVersionId,
      isDefault: branches.length === 0, // First branch is default
    };

    branches.push(branch);
    this.branches.set(workflowId, branches);
    this.saveData();

    return branch;
  }

  /**
   * Delete a branch
   */
  deleteBranch(branchId: string): boolean {
    for (const [workflowId, branches] of this.branches.entries()) {
      const index = branches.findIndex((b) => b.id === branchId);
      if (index !== -1) {
        const branch = branches[index];

        // Don't allow deleting default branch if there are other branches
        if (branch.isDefault && branches.length > 1) {
          throw new Error(
            "Cannot delete default branch. Set another branch as default first."
          );
        }

        branches.splice(index, 1);
        this.branches.set(workflowId, branches);

        // If this was the current branch, switch to default
        if (this.currentBranch.get(workflowId) === branchId) {
          const defaultBranch = branches.find((b) => b.isDefault);
          if (defaultBranch) {
            this.currentBranch.set(workflowId, defaultBranch.id);
          } else {
            this.currentBranch.delete(workflowId);
          }
        }

        this.saveData();
        return true;
      }
    }
    return false;
  }

  /**
   * Get a branch by ID
   */
  getBranch(branchId: string): Branch | undefined {
    for (const branches of this.branches.values()) {
      const branch = branches.find((b) => b.id === branchId);
      if (branch) return branch;
    }
    return undefined;
  }

  /**
   * Get all branches for a workflow
   */
  getAllBranches(workflowId: string): Branch[] {
    return this.branches.get(workflowId) || [];
  }

  /**
   * Switch to a different branch
   */
  switchBranch(workflowId: string, branchId: string): Branch {
    const branch = this.getBranch(branchId);
    if (!branch) {
      throw new Error(`Branch not found: ${branchId}`);
    }
    if (branch.workflowId !== workflowId) {
      throw new Error("Branch does not belong to this workflow");
    }

    this.currentBranch.set(workflowId, branchId);
    this.saveData();
    return branch;
  }

  /**
   * Get current branch for a workflow
   */
  getCurrentBranch(workflowId: string): Branch | undefined {
    const branchId = this.currentBranch.get(workflowId);
    if (branchId) {
      return this.getBranch(branchId);
    }

    // Return default branch if no current branch set
    const branches = this.getAllBranches(workflowId);
    return branches.find((b) => b.isDefault);
  }

  /**
   * Merge one branch into another
   */
  mergeBranch(
    sourceBranchId: string,
    targetBranchId: string,
    author?: string
  ): MergeResult {
    const sourceBranch = this.getBranch(sourceBranchId);
    const targetBranch = this.getBranch(targetBranchId);

    if (!sourceBranch || !targetBranch) {
      return {
        success: false,
        conflicts: [],
        message: "Source or target branch not found",
      };
    }

    if (sourceBranch.workflowId !== targetBranch.workflowId) {
      return {
        success: false,
        conflicts: [],
        message: "Branches belong to different workflows",
      };
    }

    // Get latest versions from both branches
    const sourceVersion = sourceBranch.currentVersionId
      ? this.getVersion(sourceBranch.currentVersionId)
      : undefined;
    const targetVersion = targetBranch.currentVersionId
      ? this.getVersion(targetBranch.currentVersionId)
      : undefined;

    if (!sourceVersion) {
      return {
        success: false,
        conflicts: [],
        message: "Source branch has no versions",
      };
    }

    // Detect conflicts
    const conflicts = this.detectConflicts(sourceBranchId, targetBranchId);

    if (conflicts.length > 0) {
      return {
        success: false,
        conflicts,
        message: `Merge has ${conflicts.length} conflict(s)`,
      };
    }

    // Perform auto-merge
    const mergedWorkflow = sourceVersion.workflow;

    // Create new version in target branch
    const version = this.saveVersion(
      targetBranch.workflowId,
      targetBranchId,
      mergedWorkflow,
      `Merge branch '${sourceBranch.name}' into '${targetBranch.name}'`,
      author
    );

    return {
      success: true,
      workflow: mergedWorkflow,
      conflicts: [],
      message: "Merge successful",
    };
  }

  // ==========================================================================
  // Version Management
  // ==========================================================================

  /**
   * Save a new version
   */
  saveVersion(
    workflowId: string,
    branchId: string,
    workflow: Workflow,
    message: string,
    author?: string
  ): Version {
    const branch = this.getBranch(branchId);
    if (!branch || branch.workflowId !== workflowId) {
      throw new Error("Invalid branch");
    }

    // Calculate changes from previous version
    let changesSummary: ChangeSummary | undefined;
    if (branch.currentVersionId) {
      const previousVersion = this.getVersion(branch.currentVersionId);
      if (previousVersion) {
        const changes = this.detectChanges(previousVersion.workflow, workflow);
        changesSummary = this.summarizeChanges(changes);
      }
    }

    const version: Version = {
      id: this.generateId("version"),
      workflowId,
      branchId,
      workflow: cloneWorkflow(workflow, workflow.id),
      message,
      author,
      timestamp: new Date().toISOString(),
      parentVersionId: branch.currentVersionId,
      metadata: {
        actionCount: workflow.actions.length,
        connectionCount: this.countConnections(workflow.connections),
        changesSummary,
      },
    };

    // Add to versions list
    const versions = this.versions.get(workflowId) || [];
    versions.push(version);
    this.versions.set(workflowId, versions);

    // Update branch's current version
    branch.currentVersionId = version.id;
    branch.updatedAt = new Date().toISOString();
    this.updateBranch(branch);

    this.saveData();
    return version;
  }

  /**
   * Get a version by ID
   */
  getVersion(versionId: string): Version | undefined {
    for (const versions of this.versions.values()) {
      const version = versions.find((v) => v.id === versionId);
      if (version) return version;
    }
    return undefined;
  }

  /**
   * Get version history for a workflow (optionally filtered by branch)
   */
  getVersionHistory(workflowId: string, branchId?: string): Version[] {
    const versions = this.versions.get(workflowId) || [];
    const filtered = branchId
      ? versions.filter((v) => v.branchId === branchId)
      : versions;

    return filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Get all versions for a workflow
   */
  getAllVersions(workflowId: string): Version[] {
    return this.getVersionHistory(workflowId);
  }

  /**
   * Rollback to a previous version
   */
  rollbackToVersion(
    workflowId: string,
    versionId: string,
    author?: string
  ): Version {
    const version = this.getVersion(versionId);
    if (!version || version.workflowId !== workflowId) {
      throw new Error("Version not found");
    }

    const branch = this.getBranch(version.branchId);
    if (!branch) {
      throw new Error("Branch not found");
    }

    // Create new version from rolled-back state
    return this.saveVersion(
      workflowId,
      version.branchId,
      version.workflow,
      `Rollback to version: ${version.message}`,
      author
    );
  }

  /**
   * Get latest version for a workflow on a specific branch
   */
  getLatestVersion(workflowId: string, branchId?: string): Version | undefined {
    const history = this.getVersionHistory(workflowId, branchId);
    return history.length > 0 ? history[0] : undefined;
  }

  // ==========================================================================
  // Tagging
  // ==========================================================================

  /**
   * Create a tag for a version
   */
  createTag(
    workflowId: string,
    versionId: string,
    tagName: string,
    description?: string
  ): Tag {
    const version = this.getVersion(versionId);
    if (!version || version.workflowId !== workflowId) {
      throw new Error("Version not found");
    }

    const tags = this.tags.get(workflowId) || [];

    // Check if tag name already exists
    if (tags.some((t) => t.name === tagName)) {
      throw new Error(`Tag "${tagName}" already exists`);
    }

    const tag: Tag = {
      id: this.generateId("tag"),
      workflowId,
      versionId,
      name: tagName,
      description,
      createdAt: new Date().toISOString(),
    };

    tags.push(tag);
    this.tags.set(workflowId, tags);
    this.saveData();

    return tag;
  }

  /**
   * Delete a tag
   */
  deleteTag(tagId: string): boolean {
    for (const [workflowId, tags] of this.tags.entries()) {
      const index = tags.findIndex((t) => t.id === tagId);
      if (index !== -1) {
        tags.splice(index, 1);
        this.tags.set(workflowId, tags);
        this.saveData();
        return true;
      }
    }
    return false;
  }

  /**
   * Get a tag by ID
   */
  getTag(tagId: string): Tag | undefined {
    for (const tags of this.tags.values()) {
      const tag = tags.find((t) => t.id === tagId);
      if (tag) return tag;
    }
    return undefined;
  }

  /**
   * Get all tags for a workflow
   */
  getAllTags(workflowId: string): Tag[] {
    return this.tags.get(workflowId) || [];
  }

  /**
   * Get version by tag name
   */
  getVersionByTag(workflowId: string, tagName: string): Version | undefined {
    const tags = this.getAllTags(workflowId);
    const tag = tags.find((t) => t.name === tagName);
    return tag ? this.getVersion(tag.versionId) : undefined;
  }

  // ==========================================================================
  // Diff & Compare
  // ==========================================================================

  /**
   * Compare two versions with detailed diff
   */
  compareVersions(version1Id: string, version2Id: string): VersionDiff | null {
    const version1 = this.getVersion(version1Id);
    const version2 = this.getVersion(version2Id);

    if (!version1 || !version2) {
      return null;
    }

    return this.compareWorkflows(version1.workflow, version2.workflow);
  }

  /**
   * Compare two workflows structurally
   */
  compareWorkflows(workflow1: Workflow, workflow2: Workflow): VersionDiff {
    return this.getDiff(workflow1, workflow2);
  }

  /**
   * Get detailed diff between two workflows
   */
  getDiff(workflow1: Workflow, workflow2: Workflow): VersionDiff {
    const actionsAdded: ActionDiff[] = [];
    const actionsRemoved: ActionDiff[] = [];
    const actionsModified: ActionModification[] = [];
    const actionsUnchanged: string[] = [];

    const ids1 = new Set(workflow1.actions.map((a) => a.id));
    const ids2 = new Set(workflow2.actions.map((a) => a.id));

    // Find added actions
    workflow2.actions.forEach((action) => {
      if (!ids1.has(action.id)) {
        actionsAdded.push({
          id: action.id,
          type: action.type,
          name: action.name,
          position: action.position,
          config: action.config,
        });
      }
    });

    // Find removed actions
    workflow1.actions.forEach((action) => {
      if (!ids2.has(action.id)) {
        actionsRemoved.push({
          id: action.id,
          type: action.type,
          name: action.name,
          position: action.position,
          config: action.config,
        });
      }
    });

    // Find modified and unchanged actions
    workflow1.actions.forEach((action1) => {
      if (ids2.has(action1.id)) {
        const action2 = workflow2.actions.find((a) => a.id === action1.id)!;
        const modification = this.compareActions(action1, action2);

        if (modification) {
          actionsModified.push({
            id: action1.id,
            changes: modification,
          });
        } else {
          actionsUnchanged.push(action1.id);
        }
      }
    });

    // Compare connections
    const connectionChanges = this.compareConnections(
      workflow1.connections,
      workflow2.connections
    );

    // Compare properties
    const propertiesChanged = this.compareProperties(workflow1, workflow2);

    // Compare variables
    const variablesChanged = this.compareVariables(workflow1, workflow2);

    // Calculate summary
    const summary: DiffSummary = {
      actionsAdded: actionsAdded.length,
      actionsRemoved: actionsRemoved.length,
      actionsModified: actionsModified.length,
      connectionsChanged:
        connectionChanges.connectionsAdded.length +
        connectionChanges.connectionsRemoved.length +
        connectionChanges.connectionsModified.length,
      propertiesChanged: propertiesChanged.length,
      variablesChanged: variablesChanged.length,
      totalChanges:
        actionsAdded.length +
        actionsRemoved.length +
        actionsModified.length +
        connectionChanges.connectionsAdded.length +
        connectionChanges.connectionsRemoved.length +
        connectionChanges.connectionsModified.length +
        propertiesChanged.length +
        variablesChanged.length,
    };

    return {
      actionsAdded,
      actionsRemoved,
      actionsModified,
      actionsUnchanged,
      ...connectionChanges,
      propertiesChanged,
      variablesChanged,
      summary,
    };
  }

  // ==========================================================================
  // Merge Operations
  // ==========================================================================

  /**
   * Detect conflicts between two branches
   */
  detectConflicts(
    sourceBranchId: string,
    targetBranchId: string
  ): MergeConflict[] {
    const sourceBranch = this.getBranch(sourceBranchId);
    const targetBranch = this.getBranch(targetBranchId);

    if (!sourceBranch || !targetBranch) {
      return [];
    }

    const sourceVersion = sourceBranch.currentVersionId
      ? this.getVersion(sourceBranch.currentVersionId)
      : undefined;
    const targetVersion = targetBranch.currentVersionId
      ? this.getVersion(targetBranch.currentVersionId)
      : undefined;

    if (!sourceVersion || !targetVersion) {
      return [];
    }

    return this.getConflicts(sourceBranchId, targetBranchId);
  }

  /**
   * Resolve a merge conflict
   */
  resolveMergeConflict(
    conflictId: string,
    resolution: ConflictResolution
  ): boolean {
    // This would be implemented with a conflict tracking system
    // For now, return true as a placeholder
    return true;
  }

  /**
   * Auto-merge if no conflicts exist
   */
  autoMerge(
    sourceBranchId: string,
    targetBranchId: string,
    author?: string
  ): MergeResult {
    return this.mergeBranch(sourceBranchId, targetBranchId, author);
  }

  /**
   * Get conflicts between two branches
   */
  getConflicts(
    sourceBranchId: string,
    targetBranchId: string
  ): MergeConflict[] {
    const conflicts: MergeConflict[] = [];

    const sourceBranch = this.getBranch(sourceBranchId);
    const targetBranch = this.getBranch(targetBranchId);

    if (!sourceBranch || !targetBranch) {
      return conflicts;
    }

    const sourceVersion = sourceBranch.currentVersionId
      ? this.getVersion(sourceBranch.currentVersionId)
      : undefined;
    const targetVersion = targetBranch.currentVersionId
      ? this.getVersion(targetBranch.currentVersionId)
      : undefined;

    if (!sourceVersion || !targetVersion) {
      return conflicts;
    }

    const sourceWorkflow = sourceVersion.workflow;
    const targetWorkflow = targetVersion.workflow;

    // Find common ancestor
    const baseVersion = this.findCommonAncestor(sourceVersion, targetVersion);
    const baseWorkflow = baseVersion?.workflow;

    // Check for conflicting action modifications
    sourceWorkflow.actions.forEach((sourceAction) => {
      const targetAction = targetWorkflow.actions.find(
        (a) => a.id === sourceAction.id
      );
      const baseAction = baseWorkflow?.actions.find(
        (a) => a.id === sourceAction.id
      );

      if (targetAction && baseAction) {
        // Both branches modified the same action
        const sourceHash = this.hashObject(sourceAction);
        const targetHash = this.hashObject(targetAction);
        const baseHash = this.hashObject(baseAction);

        if (
          sourceHash !== baseHash &&
          targetHash !== baseHash &&
          sourceHash !== targetHash
        ) {
          conflicts.push({
            id: this.generateId("conflict"),
            type: "action",
            path: `actions.${sourceAction.id}`,
            sourceValue: sourceAction,
            targetValue: targetAction,
            baseValue: baseAction,
            description: `Action "${sourceAction.name || sourceAction.id}" was modified in both branches`,
          });
        }
      }
    });

    // Check for conflicting property changes
    const propertyKeys = new Set([
      "name",
      "description",
      "category",
      "settings",
    ]);

    propertyKeys.forEach((key) => {
      const sourceVal = (sourceWorkflow as any)[key];
      const targetVal = (targetWorkflow as any)[key];
      const baseVal = baseWorkflow ? (baseWorkflow as any)[key] : undefined;

      if (baseVal !== undefined) {
        const sourceChanged =
          JSON.stringify(sourceVal) !== JSON.stringify(baseVal);
        const targetChanged =
          JSON.stringify(targetVal) !== JSON.stringify(baseVal);
        const different =
          JSON.stringify(sourceVal) !== JSON.stringify(targetVal);

        if (sourceChanged && targetChanged && different) {
          conflicts.push({
            id: this.generateId("conflict"),
            type: "property",
            path: key,
            sourceValue: sourceVal,
            targetValue: targetVal,
            baseValue: baseVal,
            description: `Property "${key}" was changed differently in both branches`,
          });
        }
      }
    });

    return conflicts;
  }

  // ==========================================================================
  // Change Tracking
  // ==========================================================================

  /**
   * Detect changes between two workflows
   */
  detectChanges(
    originalWorkflow: Workflow,
    currentWorkflow: Workflow
  ): VersionDiff {
    return this.getDiff(originalWorkflow, currentWorkflow);
  }

  /**
   * Summarize changes in human-readable format
   */
  summarizeChanges(changes: VersionDiff): ChangeSummary {
    const propertiesChanged = changes.propertiesChanged.map((p) => p.property);

    return {
      actionsAdded: changes.actionsAdded.length,
      actionsRemoved: changes.actionsRemoved.length,
      actionsModified: changes.actionsModified.length,
      connectionsChanged: changes.summary.connectionsChanged,
      propertiesChanged,
      hasStructuralChanges:
        changes.actionsAdded.length > 0 ||
        changes.actionsRemoved.length > 0 ||
        changes.summary.connectionsChanged > 0,
      hasConfigChanges: changes.actionsModified.length > 0,
    };
  }

  /**
   * Get change statistics for a workflow
   */
  getChangeStatistics(workflowId: string): ChangeStatistics {
    const versions = this.getAllVersions(workflowId);

    let totalChanges = 0;
    const changeFrequency = {
      actions: 0,
      connections: 0,
      properties: 0,
      variables: 0,
    };

    versions.forEach((version) => {
      const summary = version.metadata?.changesSummary;
      if (summary) {
        totalChanges +=
          summary.actionsAdded +
          summary.actionsRemoved +
          summary.actionsModified +
          summary.connectionsChanged;

        changeFrequency.actions +=
          summary.actionsAdded +
          summary.actionsRemoved +
          summary.actionsModified;
        changeFrequency.connections += summary.connectionsChanged;
        changeFrequency.properties += summary.propertiesChanged.length;
      }
    });

    return {
      totalVersions: versions.length,
      totalChanges,
      averageChangesPerVersion:
        versions.length > 0 ? totalChanges / versions.length : 0,
      mostActiveAreas: this.getMostActiveAreas(changeFrequency),
      changeFrequency,
    };
  }

  /**
   * Get contributors to a workflow
   */
  getContributors(workflowId: string): Contributor[] {
    const versions = this.getAllVersions(workflowId);
    const contributorMap = new Map<string, Contributor>();

    versions.forEach((version) => {
      const author = version.author || "Unknown";
      const contributor = contributorMap.get(author) || {
        author,
        versionCount: 0,
        lastContribution: version.timestamp,
        areasModified: [],
      };

      contributor.versionCount++;
      if (version.timestamp > contributor.lastContribution) {
        contributor.lastContribution = version.timestamp;
      }

      contributorMap.set(author, contributor);
    });

    return Array.from(contributorMap.values()).sort(
      (a, b) => b.versionCount - a.versionCount
    );
  }

  // ==========================================================================
  // Visual Diff
  // ==========================================================================

  /**
   * Generate visual diff data for UI rendering
   */
  generateVisualDiff(
    version1Id: string,
    version2Id: string
  ): VersionDiff | null {
    return this.compareVersions(version1Id, version2Id);
  }

  /**
   * Get added nodes from diff
   */
  getAddedNodes(diff: VersionDiff): ActionDiff[] {
    return diff.actionsAdded;
  }

  /**
   * Get removed nodes from diff
   */
  getRemovedNodes(diff: VersionDiff): ActionDiff[] {
    return diff.actionsRemoved;
  }

  /**
   * Get modified nodes from diff
   */
  getModifiedNodes(diff: VersionDiff): ActionModification[] {
    return diff.actionsModified;
  }

  /**
   * Get connection changes from diff
   */
  getConnectionChanges(diff: VersionDiff): {
    added: ConnectionDiff[];
    removed: ConnectionDiff[];
    modified: ConnectionModification[];
  } {
    return {
      added: diff.connectionsAdded,
      removed: diff.connectionsRemoved,
      modified: diff.connectionsModified,
    };
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  /**
   * Export a branch with all its versions
   */
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

  /**
   * Import a branch from exported data
   */
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
      console.error("Failed to import branch:", error);
      return null;
    }
  }

  /**
   * Export complete version history for a workflow
   */
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

  /**
   * Import version history from exported data
   */
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
      console.error("Failed to import version history:", error);
      return false;
    }
  }

  // ==========================================================================
  // Integration with Snapshots
  // ==========================================================================

  /**
   * Migrate snapshots to version control system
   */
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
    snapshotsByWorkflow.forEach((snapshots, workflowId) => {
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

      // Convert each snapshot to a version
      snapshots
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .forEach((snapshot) => {
          this.saveVersion(
            workflowId,
            mainBranch.id,
            snapshot.workflow,
            snapshot.name,
            snapshot.metadata?.author
          );
          migrated++;
        });
    });

    return migrated;
  }

  /**
   * Create a version from an existing snapshot
   */
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
        targetBranchId = branches[0].id;
      }
    }

    return this.saveVersion(
      snapshot.workflowId,
      targetBranchId,
      snapshot.workflow,
      snapshot.name,
      snapshot.metadata?.author
    );
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateBranch(branch: Branch): void {
    const branches = this.branches.get(branch.workflowId) || [];
    const index = branches.findIndex((b) => b.id === branch.id);
    if (index !== -1) {
      branches[index] = branch;
      this.branches.set(branch.workflowId, branches);
    }
  }

  private countConnections(connections: Connections): number {
    let count = 0;
    Object.values(connections).forEach((outputs) => {
      ["main", "error", "success", "parallel"].forEach((type) => {
        const conns = outputs[type as keyof typeof outputs];
        if (conns) {
          conns.forEach((outputConns) => {
            count += outputConns.length;
          });
        }
      });
    });
    return count;
  }

  private compareActions(
    action1: Action,
    action2: Action
  ): ActionModification["changes"] | null {
    const changes: ActionModification["changes"] = {};

    if (action1.type !== action2.type) {
      changes.type = { old: action1.type, new: action2.type };
    }

    if (action1.name !== action2.name) {
      changes.name = { old: action1.name, new: action2.name };
    }

    const config1 = JSON.stringify(action1.config);
    const config2 = JSON.stringify(action2.config);
    if (config1 !== config2) {
      changes.config = {
        old: action1.config,
        new: action2.config,
        fields: this.getChangedFields(action1.config, action2.config),
      };
    }

    const pos1 = JSON.stringify(action1.position);
    const pos2 = JSON.stringify(action2.position);
    if (pos1 !== pos2) {
      changes.position = { old: action1.position, new: action2.position };
    }

    const base1 = JSON.stringify(action1.base);
    const base2 = JSON.stringify(action2.base);
    if (base1 !== base2) {
      changes.base = { old: action1.base, new: action2.base };
    }

    const exec1 = JSON.stringify(action1.execution);
    const exec2 = JSON.stringify(action2.execution);
    if (exec1 !== exec2) {
      changes.execution = { old: action1.execution, new: action2.execution };
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  private getChangedFields(obj1: any, obj2: any): string[] {
    const fields: string[] = [];
    const allKeys = new Set([
      ...Object.keys(obj1 || {}),
      ...Object.keys(obj2 || {}),
    ]);

    allKeys.forEach((key) => {
      if (JSON.stringify(obj1?.[key]) !== JSON.stringify(obj2?.[key])) {
        fields.push(key);
      }
    });

    return fields;
  }

  private compareConnections(
    connections1: Connections,
    connections2: Connections
  ): {
    connectionsAdded: ConnectionDiff[];
    connectionsRemoved: ConnectionDiff[];
    connectionsModified: ConnectionModification[];
  } {
    const added: ConnectionDiff[] = [];
    const removed: ConnectionDiff[] = [];
    const modified: ConnectionModification[] = [];

    const allSources = new Set([
      ...Object.keys(connections1),
      ...Object.keys(connections2),
    ]);

    allSources.forEach((source) => {
      const conns1 = connections1[source];
      const conns2 = connections2[source];

      if (!conns1 && conns2) {
        // All connections from this source are new
        this.extractConnections(conns2, source).forEach((conn) =>
          added.push(conn)
        );
      } else if (conns1 && !conns2) {
        // All connections from this source are removed
        this.extractConnections(conns1, source).forEach((conn) =>
          removed.push(conn)
        );
      } else if (conns1 && conns2) {
        // Compare connections
        const conns1List = this.extractConnections(conns1, source);
        const conns2List = this.extractConnections(conns2, source);

        conns2List.forEach((conn2) => {
          const exists = conns1List.some(
            (conn1) =>
              conn1.target === conn2.target &&
              conn1.type === conn2.type &&
              conn1.outputIndex === conn2.outputIndex
          );
          if (!exists) {
            added.push(conn2);
          }
        });

        conns1List.forEach((conn1) => {
          const exists = conns2List.some(
            (conn2) =>
              conn1.target === conn2.target &&
              conn1.type === conn2.type &&
              conn1.outputIndex === conn2.outputIndex
          );
          if (!exists) {
            removed.push(conn1);
          }
        });
      }
    });

    return {
      connectionsAdded: added,
      connectionsRemoved: removed,
      connectionsModified: modified,
    };
  }

  private extractConnections(
    outputs: Connections[string],
    source: string
  ): ConnectionDiff[] {
    const connections: ConnectionDiff[] = [];

    (["main", "error", "success", "parallel"] as const).forEach((type) => {
      const conns = outputs[type];
      if (conns) {
        conns.forEach((outputConns, outputIndex) => {
          outputConns.forEach((conn) => {
            connections.push({
              source,
              target: conn.action,
              type: type,
              outputIndex,
              inputIndex: conn.index,
            });
          });
        });
      }
    });

    return connections;
  }

  private compareProperties(
    workflow1: Workflow,
    workflow2: Workflow
  ): PropertyChange[] {
    const changes: PropertyChange[] = [];

    const properties = [
      "name",
      "description",
      "category",
      "version",
      "tags",
      "settings",
    ];

    properties.forEach((prop) => {
      const val1 = (workflow1 as any)[prop];
      const val2 = (workflow2 as any)[prop];

      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        changes.push({
          property: prop,
          oldValue: val1,
          newValue: val2,
        });
      }
    });

    return changes;
  }

  private compareVariables(
    workflow1: Workflow,
    workflow2: Workflow
  ): VariableChange[] {
    const changes: VariableChange[] = [];

    const scopes: Array<"local" | "process" | "global"> = [
      "local",
      "process",
      "global",
    ];

    scopes.forEach((scope) => {
      const vars1 = workflow1.variables?.[scope] || {};
      const vars2 = workflow2.variables?.[scope] || {};

      const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)]);

      allKeys.forEach((key) => {
        const val1 = vars1[key];
        const val2 = vars2[key];

        if (val1 === undefined && val2 !== undefined) {
          changes.push({ scope, key, newValue: val2, type: "added" });
        } else if (val1 !== undefined && val2 === undefined) {
          changes.push({ scope, key, oldValue: val1, type: "removed" });
        } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          changes.push({
            scope,
            key,
            oldValue: val1,
            newValue: val2,
            type: "modified",
          });
        }
      });
    });

    return changes;
  }

  private findCommonAncestor(
    version1: Version,
    version2: Version
  ): Version | undefined {
    const ancestors1 = this.getAncestors(version1);
    const ancestors2 = this.getAncestors(version2);

    for (const ancestor1 of ancestors1) {
      if (ancestors2.some((a) => a.id === ancestor1.id)) {
        return ancestor1;
      }
    }

    return undefined;
  }

  private getAncestors(version: Version): Version[] {
    const ancestors: Version[] = [];
    let current: Version | undefined = version;

    while (current?.parentVersionId) {
      current = this.getVersion(current.parentVersionId);
      if (current) {
        ancestors.push(current);
      } else {
        break;
      }
    }

    return ancestors;
  }

  private hashObject(obj: any): string {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private getMostActiveAreas(
    frequency: ChangeStatistics["changeFrequency"]
  ): string[] {
    const areas: Array<{ name: string; count: number }> = [
      { name: "actions", count: frequency.actions },
      { name: "connections", count: frequency.connections },
      { name: "properties", count: frequency.properties },
      { name: "variables", count: frequency.variables },
    ];

    return areas
      .sort((a, b) => b.count - a.count)
      .filter((a) => a.count > 0)
      .map((a) => a.name);
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private loadData(): void {
    try {
      const branchesJson = localStorage.getItem("workflow-branches");
      if (branchesJson) {
        const data = JSON.parse(branchesJson);
        this.branches = new Map(Object.entries(data));
      }

      const versionsJson = localStorage.getItem("workflow-versions");
      if (versionsJson) {
        const data = JSON.parse(versionsJson);
        this.versions = new Map(Object.entries(data));
      }

      const tagsJson = localStorage.getItem("workflow-version-tags");
      if (tagsJson) {
        const data = JSON.parse(tagsJson);
        this.tags = new Map(Object.entries(data));
      }

      const currentBranchJson = localStorage.getItem("workflow-current-branch");
      if (currentBranchJson) {
        const data = JSON.parse(currentBranchJson);
        this.currentBranch = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error("Failed to load version control data:", error);
    }
  }

  private saveData(): void {
    try {
      localStorage.setItem(
        "workflow-branches",
        JSON.stringify(Object.fromEntries(this.branches))
      );
      localStorage.setItem(
        "workflow-versions",
        JSON.stringify(Object.fromEntries(this.versions))
      );
      localStorage.setItem(
        "workflow-version-tags",
        JSON.stringify(Object.fromEntries(this.tags))
      );
      localStorage.setItem(
        "workflow-current-branch",
        JSON.stringify(Object.fromEntries(this.currentBranch))
      );
    } catch (error) {
      console.error("Failed to save version control data:", error);
    }
  }

  /**
   * Clear all version control data
   */
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
      localStorage.removeItem("workflow-branches");
      localStorage.removeItem("workflow-versions");
      localStorage.removeItem("workflow-version-tags");
      localStorage.removeItem("workflow-current-branch");
    }
    this.saveData();
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowVersionControl = WorkflowVersionControl.getInstance();
