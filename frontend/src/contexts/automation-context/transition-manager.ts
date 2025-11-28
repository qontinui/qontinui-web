import { Transition, OutgoingTransition, IncomingTransition } from "./types";

export class TransitionManager {
  static addTransition(
    transitions: Transition[],
    newTransition: Transition
  ): Transition[] {
    return [...transitions, newTransition];
  }

  static updateTransition(
    transitions: Transition[],
    updatedTransition: Transition
  ): Transition[] {
    return transitions.map((t) =>
      t.id === updatedTransition.id ? updatedTransition : t
    );
  }

  static deleteTransition(
    transitions: Transition[],
    transitionId: string
  ): Transition[] {
    return transitions.filter((t) => t.id !== transitionId);
  }

  static removeStateFromTransitions(
    transitions: Transition[],
    stateId: string
  ): Transition[] {
    return transitions.filter((t) => {
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
  }

  static removeProcessFromTransitions(
    transitions: Transition[],
    processId: string
  ): Transition[] {
    return transitions.map((t) => ({
      ...t,
      workflows: t.workflows.filter((wid) => wid !== processId),
    }));
  }
}
