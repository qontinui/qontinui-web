/**
 * Workflow Version Control - Branch Manager
 *
 * Branch CRUD and operations (create, delete, switch, get).
 */

import type { Branch, Version, Tag } from "./types";

// ============================================================================
// Branch Manager
// ============================================================================

export class BranchManager {
  constructor(
    private branches: Map<string, Branch[]>,
    _versions: Map<string, Version[]>,
    _tags: Map<string, Tag[]>,
    private currentBranch: Map<string, string>,
    private generateId: (prefix: string) => string,
    private saveData: () => void
  ) {}

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
        if (!branch) return false;

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
   * Update a branch in the store
   */
  updateBranch(branch: Branch): void {
    const branches = this.branches.get(branch.workflowId) || [];
    const index = branches.findIndex((b) => b.id === branch.id);
    if (index !== -1) {
      branches[index] = branch;
      this.branches.set(branch.workflowId, branches);
    }
  }
}
