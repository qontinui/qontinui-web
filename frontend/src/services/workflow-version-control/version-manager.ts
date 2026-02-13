/**
 * Workflow Version Control - Version Manager
 *
 * Version CRUD, history, rollback, and change statistics.
 */

import type { Workflow, Connections } from "../../lib/action-schema/action-types";
import { cloneWorkflow } from "../../lib/action-schema/workflow-utils";
import type {
  Version,
  ChangeSummary,
  ChangeStatistics,
  Contributor,
  VersionDiff,
  ActionDiff,
  ActionModification,
  ConnectionDiff,
  ConnectionModification,
} from "./types";
import { getDiff, summarizeChanges } from "./diff-engine";
import type { BranchManager } from "./branch-manager";

// ============================================================================
// Version Manager
// ============================================================================

export class VersionManager {
  constructor(
    private versions: Map<string, Version[]>,
    private branchManager: BranchManager,
    private generateId: (prefix: string) => string,
    private saveData: () => void
  ) {}

  // ==========================================================================
  // Version CRUD
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
    const branch = this.branchManager.getBranch(branchId);
    if (!branch || branch.workflowId !== workflowId) {
      throw new Error("Invalid branch");
    }

    // Calculate changes from previous version
    let changesSummary: ChangeSummary | undefined;
    if (branch.currentVersionId) {
      const previousVersion = this.getVersion(branch.currentVersionId);
      if (previousVersion) {
        const changes = getDiff(previousVersion.workflow, workflow);
        changesSummary = summarizeChanges(changes);
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
    this.branchManager.updateBranch(branch);

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

    const branch = this.branchManager.getBranch(version.branchId);
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
  // Visual Diff Helpers
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

    return getDiff(version1.workflow, version2.workflow);
  }

  /**
   * Compare two workflows structurally
   */
  compareWorkflows(workflow1: Workflow, workflow2: Workflow): VersionDiff {
    return getDiff(workflow1, workflow2);
  }

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
  // Change Tracking
  // ==========================================================================

  /**
   * Detect changes between two workflows
   */
  detectChanges(
    originalWorkflow: Workflow,
    currentWorkflow: Workflow
  ): VersionDiff {
    return getDiff(originalWorkflow, currentWorkflow);
  }

  /**
   * Summarize changes in human-readable format
   */
  summarizeChanges(changes: VersionDiff): ChangeSummary {
    return summarizeChanges(changes);
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

  /**
   * Find common ancestor of two versions
   */
  findCommonAncestor(
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

  /**
   * Get ancestor chain of a version
   */
  getAncestors(version: Version): Version[] {
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

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

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
}
