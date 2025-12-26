/**
 * State Repository
 *
 * Handles persistence for State entities.
 */

import { BaseRepository } from "./base-repository";
import type { State } from "@/contexts/automation-context/types";

/**
 * State with project context (State already has optional projectName)
 */
export type StateWithProject = State & { projectName: string };

/**
 * Repository for state persistence
 */
class StateRepositoryImpl extends BaseRepository<StateWithProject> {
  protected readonly storeName = "states";

  /**
   * Update a state with a new ID (for ID change operations)
   */
  async updateWithIdChange(oldId: string, newState: StateWithProject): Promise<void> {
    // Delete the old state and add the new one with the new ID
    await this.delete(oldId);
    await this.add(newState);
  }

  /**
   * Update projectName for all states in a project (for rename operations)
   */
  async renameProject(
    oldProjectName: string,
    newProjectName: string
  ): Promise<void> {
    const states = await this.getByProject(oldProjectName);
    await Promise.all(
      states.map((state) =>
        this.update({ ...state, projectName: newProjectName })
      )
    );
  }
}

// Export singleton instance
export const stateRepository = new StateRepositoryImpl();
