import { useState, useMemo } from "react";
import type { Transition, OutgoingTransition, State } from "../types";

export function useStateManagement(
  transition: Transition,
  states: State[],
  updateTransition: (updates: Partial<Transition>) => void
) {
  const [stateDialogOpen, setStateDialogOpen] = useState(false);
  const [selectedStateType, setSelectedStateType] = useState<
    "activate" | "deactivate"
  >("activate");

  const handleAddState = (stateId: string, type: "activate" | "deactivate") => {
    if (transition.type !== "OutgoingTransition") return;

    const key = type === "activate" ? "activateStates" : "deactivateStates";
    const currentStates = Array.isArray(transition[key]) ? transition[key] : [];

    if (!currentStates.includes(stateId)) {
      updateTransition({
        [key]: [...currentStates, stateId],
      } as Partial<OutgoingTransition>);
    }
    setStateDialogOpen(false);
  };

  const handleRemoveState = (
    stateId: string,
    type: "activate" | "deactivate"
  ) => {
    if (transition.type !== "OutgoingTransition") return;

    const key = type === "activate" ? "activateStates" : "deactivateStates";
    const currentStates = Array.isArray(transition[key]) ? transition[key] : [];
    updateTransition({
      [key]: currentStates.filter((id) => id !== stateId),
    } as Partial<OutgoingTransition>);
  };

  const availableStates = useMemo(
    () =>
      states.filter((state) => {
        if (transition.type !== "OutgoingTransition") return false;
        if (state.id === transition.fromState) return false;

        const activateStates = Array.isArray(transition.activateStates)
          ? transition.activateStates
          : [];
        const deactivateStates = Array.isArray(transition.deactivateStates)
          ? transition.deactivateStates
          : [];

        return selectedStateType === "activate"
          ? !activateStates.includes(state.id) &&
              !deactivateStates.includes(state.id)
          : !deactivateStates.includes(state.id) &&
              !activateStates.includes(state.id);
      }),
    [transition, states, selectedStateType]
  );

  return {
    stateDialogOpen,
    setStateDialogOpen,
    selectedStateType,
    setSelectedStateType,
    handleAddState,
    handleRemoveState,
    availableStates,
  };
}
