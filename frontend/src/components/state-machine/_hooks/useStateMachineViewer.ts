import { useState, useMemo, useCallback } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import type {
  StateDiscoveryResult,
  DiscoveredState,
  StateImage,
} from "@/types/state-machine";

export function useStateMachineViewer(result: StateDiscoveryResult) {
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const { expanded: expandedStates, toggle: toggleExpanded } =
    useExpandableSet();

  const stateMap = useMemo(() => {
    const map = new Map<string, DiscoveredState>();
    result.states.forEach((s) => map.set(s.id, s));
    return map;
  }, [result.states]);

  const imageMap = useMemo(() => {
    const map = new Map<string, StateImage>();
    result.images.forEach((img) => map.set(img.id, img));
    return map;
  }, [result.images]);

  const getOutgoingTransitions = useCallback(
    (stateId: string) =>
      result.transitions.filter((t) => t.fromStateId === stateId),
    [result.transitions]
  );

  const getIncomingTransitions = useCallback(
    (stateId: string) =>
      result.transitions.filter((t) => t.toStateId === stateId),
    [result.transitions]
  );

  const handleStateClick = useCallback(
    (
      state: DiscoveredState,
      onStateSelect?: (state: DiscoveredState) => void
    ) => {
      setSelectedStateId(state.id);
      onStateSelect?.(state);
    },
    []
  );

  const selectedState = selectedStateId
    ? (stateMap.get(selectedStateId) ?? null)
    : null;

  return {
    selectedStateId,
    expandedStates,
    stateMap,
    imageMap,
    selectedState,
    getOutgoingTransitions,
    getIncomingTransitions,
    toggleExpanded,
    handleStateClick,
  };
}

export type StateMachineViewerHook = ReturnType<typeof useStateMachineViewer>;
