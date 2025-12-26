/**
 * Workflow Repository
 *
 * Handles persistence for Workflow entities.
 */

import { BaseRepository } from "./base-repository";
import type { Workflow } from "@/lib/action-schema/action-types";

/**
 * Workflow with project context
 */
export interface WorkflowWithProject extends Workflow {
  projectName: string;
}

/**
 * Repository for workflow persistence
 */
class WorkflowRepositoryImpl extends BaseRepository<WorkflowWithProject> {
  protected readonly storeName = "workflows";

  /**
   * Delete multiple workflows by ID
   */
  async deleteMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.delete(id)));
  }

  /**
   * Update projectName for all workflows in a project (for rename operations)
   */
  async renameProject(
    oldProjectName: string,
    newProjectName: string
  ): Promise<void> {
    const workflows = await this.getByProject(oldProjectName);
    await Promise.all(
      workflows.map((workflow) =>
        this.update({ ...workflow, projectName: newProjectName })
      )
    );
  }
}

// Export singleton instance
export const workflowRepository = new WorkflowRepositoryImpl();
