import { useMemo } from "react";
import {
  Transition,
  State,
  OutgoingTransition,
} from "@/contexts/automation-context/types";
import { TransitionValidation } from "../types";

export function useTransitionValidation(
  transitions: Transition[],
  states: State[]
): TransitionValidation {
  return useMemo(
    () => analyzeTransitions(transitions, states),
    [transitions, states]
  );
}

function analyzeTransitions(
  transitions: Transition[],
  states: State[]
): TransitionValidation {
  const validation: TransitionValidation = {
    circular: [],
    brokenStateReferences: [],
    missingWorkflows: [],
    unreachableStates: [],
    deadEndStates: [],
  };

  const stateIds = new Set(states.map((s) => s.id));

  // Check for broken state references
  transitions.forEach((t) => {
    if (t.type === "OutgoingTransition") {
      if (!stateIds.has(t.fromState)) {
        validation.brokenStateReferences.push(t.id);
      }
      t.activateStates.forEach((stateId) => {
        if (!stateIds.has(stateId)) {
          validation.brokenStateReferences.push(t.id);
        }
      });
    } else if (t.type === "IncomingTransition") {
      if (!stateIds.has(t.toState)) {
        validation.brokenStateReferences.push(t.id);
      }
    }
  });

  // Detect circular transitions (simplified)
  const outgoingTransitions = transitions.filter(
    (t): t is OutgoingTransition => t.type === "OutgoingTransition"
  );

  outgoingTransitions.forEach((t) => {
    t.activateStates.forEach((targetState) => {
      const reverseTransition = outgoingTransitions.find(
        (ot) =>
          ot.fromState === targetState &&
          ot.activateStates.includes(t.fromState)
      );
      if (reverseTransition) {
        if (!validation.circular.includes(t.id)) {
          validation.circular.push(t.id);
        }
      }
    });
  });

  // Find unreachable states (states with no incoming transitions)
  const reachableStates = new Set<string>();
  outgoingTransitions.forEach((t) => {
    t.activateStates.forEach((stateId) => reachableStates.add(stateId));
  });

  states.forEach((state) => {
    if (!state.initial && !reachableStates.has(state.id)) {
      validation.unreachableStates.push(state.id);
    }
  });

  // Find dead-end states (states with no outgoing transitions)
  const statesWithOutgoing = new Set(
    outgoingTransitions.map((t) => t.fromState)
  );
  states.forEach((state) => {
    if (!statesWithOutgoing.has(state.id)) {
      validation.deadEndStates.push(state.id);
    }
  });

  return validation;
}
