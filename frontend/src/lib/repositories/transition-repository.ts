/**
 * Transition Repository
 *
 * Handles persistence for Transition entities.
 */

import { BaseRepository } from "./base-repository";
import type { Transition } from "@/contexts/automation-context/types";

/**
 * Transition with project context (Transition already has optional projectName)
 */
export type TransitionWithProject = Transition & { projectName: string };

/**
 * Repository for transition persistence
 */
class TransitionRepositoryImpl extends BaseRepository<TransitionWithProject> {
  protected readonly storeName = "transitions";

  /**
   * Update projectName for all transitions in a project (for rename operations)
   */
  async renameProject(
    oldProjectName: string,
    newProjectName: string
  ): Promise<void> {
    const transitions = await this.getByProject(oldProjectName);
    await Promise.all(
      transitions.map((transition) =>
        this.update({ ...transition, projectName: newProjectName })
      )
    );
  }

  /**
   * Remove references to a state from all transitions
   */
  async removeStateReferences(
    projectName: string,
    stateId: string
  ): Promise<void> {
    const transitions = await this.getByProject(projectName);

    const updatedTransitions = transitions
      .map((transition) => {
        if (transition.type === "OutgoingTransition") {
          // Remove stateId from fromState, toState, activateStates, deactivateStates
          const updates: Partial<typeof transition> = {};

          if (transition.fromState === stateId) {
            updates.fromState = "";
          }
          if (transition.toState === stateId) {
            updates.toState = undefined;
          }
          if (transition.activateStates?.includes(stateId)) {
            updates.activateStates = transition.activateStates.filter(
              (id) => id !== stateId
            );
          }
          if (transition.deactivateStates?.includes(stateId)) {
            updates.deactivateStates = transition.deactivateStates.filter(
              (id) => id !== stateId
            );
          }

          if (Object.keys(updates).length > 0) {
            return { ...transition, ...updates };
          }
        } else if (transition.type === "IncomingTransition") {
          if (transition.toState === stateId) {
            return { ...transition, toState: "" };
          }
        }
        return null; // No changes needed
      })
      .filter((t): t is TransitionWithProject => t !== null);

    await Promise.all(updatedTransitions.map((t) => this.update(t)));
  }
}

// Export singleton instance
export const transitionRepository = new TransitionRepositoryImpl();
