import { Transition } from "./types";

/**
 * Updates transition references when state IDs change.
 * Single Responsibility: Handle transition reference updates
 */
export class TransitionReferenceUpdater {
  /**
   * Update all transitions that reference an old state ID to use the new ID
   */
  static updateStateReferences(
    transitions: Transition[],
    oldStateId: string,
    newStateId: string
  ): Transition[] {
    return transitions.map((transition) => {
      const needsUpdate = this.transitionReferencesState(
        transition,
        oldStateId
      );

      if (!needsUpdate) {
        return transition;
      }

      return this.updateTransitionReference(transition, oldStateId, newStateId);
    });
  }

  /**
   * Check if a transition references a specific state ID
   */
  private static transitionReferencesState(
    transition: Transition,
    stateId: string
  ): boolean {
    if (transition.type === "OutgoingTransition") {
      return (
        transition.fromState === stateId ||
        transition.activateStates.includes(stateId) ||
        transition.deactivateStates.includes(stateId)
      );
    }

    if (transition.type === "IncomingTransition") {
      return transition.toState === stateId;
    }

    return false;
  }

  /**
   * Update a single transition's references from old ID to new ID
   */
  private static updateTransitionReference(
    transition: Transition,
    oldStateId: string,
    newStateId: string
  ): Transition {
    if (transition.type === "OutgoingTransition") {
      return {
        ...transition,
        fromState:
          transition.fromState === oldStateId
            ? newStateId
            : transition.fromState,
        activateStates: transition.activateStates.map((id) =>
          id === oldStateId ? newStateId : id
        ),
        deactivateStates: transition.deactivateStates.map((id) =>
          id === oldStateId ? newStateId : id
        ),
      };
    }

    if (transition.type === "IncomingTransition") {
      return {
        ...transition,
        toState:
          transition.toState === oldStateId ? newStateId : transition.toState,
      };
    }

    return transition;
  }

  /**
   * Get list of transitions that would be affected by a state ID change
   */
  static getAffectedTransitions(
    transitions: Transition[],
    stateId: string
  ): Transition[] {
    return transitions.filter((t) =>
      this.transitionReferencesState(t, stateId)
    );
  }
}
