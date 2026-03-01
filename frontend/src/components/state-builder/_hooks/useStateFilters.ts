import { useMemo, useCallback } from "react";
import type { State } from "@/contexts/automation-context";
import type { StateWithMetadata } from "../types";

interface Transition {
  type: string;
  fromState?: string;
  toState?: string;
}

interface UseStateFiltersParams {
  states: State[];
  transitions: Transition[];
  searchQuery: string;
  selectedGroupId: string | null;
  filterTags: string[];
  filterHasImages: boolean | null;
  filterHasTransitions: boolean | null;
}

export function useStateFilters({
  states,
  transitions,
  searchQuery,
  selectedGroupId,
  filterTags,
  filterHasImages,
  filterHasTransitions,
}: UseStateFiltersParams) {
  const filteredStates = useMemo(() => {
    let filtered = states;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query)
      );
    }

    // Filter by group
    if (selectedGroupId && selectedGroupId !== "root") {
      filtered = filtered.filter(
        (s) => (s as StateWithMetadata).groupId === selectedGroupId
      );
    }

    // Filter by tags
    if (filterTags.length > 0) {
      filtered = filtered.filter((s) => {
        const stateTags = (s as StateWithMetadata).tags || [];
        return filterTags.some((tag) => stateTags.includes(tag));
      });
    }

    // Filter by has images
    if (filterHasImages !== null) {
      filtered = filtered.filter((s) =>
        filterHasImages
          ? s.stateImages && s.stateImages.length > 0
          : !s.stateImages || s.stateImages.length === 0
      );
    }

    // Filter by has transitions
    if (filterHasTransitions !== null) {
      filtered = filtered.filter((s) => {
        const hasTransitions = transitions.some(
          (t) =>
            (t.type === "OutgoingTransition" && t.fromState === s.id) ||
            (t.type === "IncomingTransition" && t.toState === s.id)
        );
        return filterHasTransitions ? hasTransitions : !hasTransitions;
      });
    }

    return filtered;
  }, [
    states,
    searchQuery,
    selectedGroupId,
    filterTags,
    filterHasImages,
    filterHasTransitions,
    transitions,
  ]);

  const stateComplexity = useCallback((state: State) => {
    let score = 0;
    score += (state.stateImages?.length || 0) * 2;
    score += (state.regions?.length || 0) * 1;
    score += (state.locations?.length || 0) * 1;
    score += (state.strings?.length || 0) * 0.5;

    // Add complexity for patterns
    state.stateImages?.forEach((si) => {
      score += (si.patterns?.length || 0) * 1.5;
    });

    return Math.round(score);
  }, []);

  const stateHasImages = useCallback(
    (state: State): boolean =>
      Boolean(state.stateImages && state.stateImages.length > 0),
    []
  );

  const stateHasTransitions = useCallback(
    (state: State) =>
      transitions.some(
        (t) =>
          (t.type === "OutgoingTransition" && t.fromState === state.id) ||
          (t.type === "IncomingTransition" && t.toState === state.id)
      ),
    [transitions]
  );

  return {
    filteredStates,
    stateComplexity,
    stateHasImages,
    stateHasTransitions,
  };
}
