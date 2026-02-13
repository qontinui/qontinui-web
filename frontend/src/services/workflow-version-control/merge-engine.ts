/**
 * Workflow Version Control - Merge Engine
 *
 * Merge operations with conflict detection and resolution.
 */

import type {
  MergeConflict,
  MergeResult,
  ConflictResolution,
} from "./types";
import type { BranchManager } from "./branch-manager";
import type { VersionManager } from "./version-manager";

// ============================================================================
// Merge Engine
// ============================================================================

export class MergeEngine {
  constructor(
    private branchManager: BranchManager,
    private versionManager: VersionManager,
    private generateId: (prefix: string) => string
  ) {}

  /**
   * Merge one branch into another
   */
  mergeBranch(
    sourceBranchId: string,
    targetBranchId: string,
    author?: string
  ): MergeResult {
    const sourceBranch = this.branchManager.getBranch(sourceBranchId);
    const targetBranch = this.branchManager.getBranch(targetBranchId);

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
      ? this.versionManager.getVersion(sourceBranch.currentVersionId)
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
    this.versionManager.saveVersion(
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

  /**
   * Detect conflicts between two branches
   */
  detectConflicts(
    sourceBranchId: string,
    targetBranchId: string
  ): MergeConflict[] {
    const sourceBranch = this.branchManager.getBranch(sourceBranchId);
    const targetBranch = this.branchManager.getBranch(targetBranchId);

    if (!sourceBranch || !targetBranch) {
      return [];
    }

    const sourceVersion = sourceBranch.currentVersionId
      ? this.versionManager.getVersion(sourceBranch.currentVersionId)
      : undefined;
    const targetVersion = targetBranch.currentVersionId
      ? this.versionManager.getVersion(targetBranch.currentVersionId)
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
    _conflictId: string,
    _resolution: ConflictResolution
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

    const sourceBranch = this.branchManager.getBranch(sourceBranchId);
    const targetBranch = this.branchManager.getBranch(targetBranchId);

    if (!sourceBranch || !targetBranch) {
      return conflicts;
    }

    const sourceVersion = sourceBranch.currentVersionId
      ? this.versionManager.getVersion(sourceBranch.currentVersionId)
      : undefined;
    const targetVersion = targetBranch.currentVersionId
      ? this.versionManager.getVersion(targetBranch.currentVersionId)
      : undefined;

    if (!sourceVersion || !targetVersion) {
      return conflicts;
    }

    const sourceWorkflow = sourceVersion.workflow;
    const targetWorkflow = targetVersion.workflow;

    // Find common ancestor
    const baseVersion = this.versionManager.findCommonAncestor(
      sourceVersion,
      targetVersion
    );
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
      const sourceVal = (sourceWorkflow as unknown as Record<string, unknown>)[
        key
      ];
      const targetVal = (targetWorkflow as unknown as Record<string, unknown>)[
        key
      ];
      const baseVal = baseWorkflow
        ? (baseWorkflow as unknown as Record<string, unknown>)[key]
        : undefined;

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
  // Private Helpers
  // ==========================================================================

  private hashObject(obj: unknown): string {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
