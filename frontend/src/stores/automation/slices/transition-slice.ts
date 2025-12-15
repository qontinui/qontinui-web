/**
 * Transition Slice
 *
 * Manages transitions between states including cross-entity cleanup.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, TransitionSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";
import { TransitionReferenceUpdater } from "@/stores/automation";

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
