/**
 * Transition Slice
 *
 * Manages transitions between states including cross-entity cleanup.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, TransitionSlice } from "../types";
import type { Transition } from "@/contexts/automation-context/types";
import { projectLogger } from "@/lib/project-logger";
import { TransitionReferenceUpdater } from "@/stores/automation";

/**
 * Check if a transition is a duplicate of an existing transition.
 * - OutgoingTransition: duplicate if same fromState AND same activateStates (as a set)
 * - IncomingTransition: duplicate if same toState
 */
function isDuplicateTransition(
  existing: Transition[],
  newTransition: Transition
): boolean {
  if (newTransition.type === "OutgoingTransition") {
    const sortedNewActivateStates = [...newTransition.activateStates].sort();
    return existing.some((t) => {
      if (t.type !== "OutgoingTransition") return false;
      if (t.fromState !== newTransition.fromState) return false;
      const sortedExistingActivateStates = [...t.activateStates].sort();
      if (
        sortedExistingActivateStates.length !== sortedNewActivateStates.length
      )
        return false;
      return sortedExistingActivateStates.every(
        (s, i) => s === sortedNewActivateStates[i]
      );
    });
  } else {
    // IncomingTransition: duplicate if same toState
    return existing.some(
      (t) =>
        t.type === "IncomingTransition" && t.toState === newTransition.toState
    );
  }
}

export { isDuplicateTransition };

export const createTransitionSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  TransitionSlice
> = (set, get) => ({
  // Initial state
  transitions: [],

  // Actions
  setTransitions: (transitions) => {
    projectLogger.debug("TransitionSlice", "setTransitions", {
      count: transitions.length,
    });
    set((state) => {
      state.transitions = transitions;
    });
  },

  addTransition: (transition) => {
    const existingTransitions = get().transitions;

    // Check for duplicates before adding
    if (isDuplicateTransition(existingTransitions, transition)) {
      projectLogger.warn("TransitionSlice", "addTransition", {
        id: transition.id,
        type: transition.type,
        message: "Duplicate transition detected, skipping",
      });
      return false; // Return false to indicate duplicate was not added
    }

    projectLogger.info("TransitionSlice", "addTransition", {
      id: transition.id,
      type: transition.type,
    });
    set((state) => {
      state.transitions.push({
        ...transition,
        projectName: state.projectName,
      });
    });
    get().triggerSave();
    return true; // Return true to indicate transition was added
  },

  updateTransition: (transition) => {
    projectLogger.debug("TransitionSlice", "updateTransition", {
      id: transition.id,
    });
    set((state) => {
      const index = state.transitions.findIndex((t) => t.id === transition.id);
      if (index !== -1) {
        state.transitions[index] = transition;
      }
    });
    get().triggerSave();
  },

  deleteTransition: (transitionId) => {
    projectLogger.info("TransitionSlice", "deleteTransition", { transitionId });
    set((state) => {
      const index = state.transitions.findIndex((t) => t.id === transitionId);
      if (index !== -1) {
        state.transitions.splice(index, 1);
      }
    });
    get().triggerSave();
  },

  // Cross-entity helpers
  removeStateFromTransitions: (stateId) => {
    projectLogger.info("TransitionSlice", "removeStateFromTransitions", {
      stateId,
    });
    set((state) => {
      // Filter out transitions that reference the deleted state
      state.transitions = state.transitions.filter((t) => {
        if (t.type === "OutgoingTransition") {
          return (
            t.fromState !== stateId &&
            !t.activateStates.includes(stateId) &&
            !t.deactivateStates.includes(stateId)
          );
        } else {
          return t.toState !== stateId;
        }
      });
    });
  },

  updateStateReferencesInTransitions: (oldStateId, newStateId) => {
    projectLogger.info(
      "TransitionSlice",
      "updateStateReferencesInTransitions",
      {
        oldStateId,
        newStateId,
      }
    );
    set((state) => {
      state.transitions = TransitionReferenceUpdater.updateStateReferences(
        state.transitions,
        oldStateId,
        newStateId
      );
    });
  },
});
