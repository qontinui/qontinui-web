/**
 * State Element CRUD Hook
 *
 * Provides add/update/remove operations for state elements:
 * StateImages, Regions, Locations, and Strings.
 */

import { useCallback } from "react";
import type {
  State,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  Pattern,
} from "@/hooks/automation";

interface UseStateElementCrudOptions {
  selectedNode: string | null;
  states: State[];
  updateSelectedState: (updates: Partial<State>) => void;
  updateState: (state: State) => void;
}

export function useStateElementCrud({
  selectedNode,
  states,
  updateSelectedState,
  updateState,
}: UseStateElementCrudOptions) {
  // ========================================================================
  // StateImage management
  // ========================================================================

  const addStateImage = useCallback(() => {
    if (!selectedNode) return;

    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const newPattern: Pattern = {
      id: `pattern_${Date.now()}`,
      imageId: "",
      searchRegions: [],
      fixed: false,
    };

    const newStateImage: StateImage = {
      id: `stateimage-${Date.now()}`,
      name: `StateImage_${(currentState.stateImages?.length || 0) + 1}`,
      patterns: [newPattern],
      shared: false,
      source: "upload",
      probability: 1.0,
    };
    const updatedStateImages = [
      ...(currentState.stateImages || []),
      newStateImage,
    ];
    updateSelectedState({ stateImages: updatedStateImages });
  }, [selectedNode, states, updateSelectedState]);

  const updateStateImage = useCallback(
    (index: number, updates: Partial<StateImage>) => {
      if (!selectedNode) return;

      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState || !currentState.stateImages) return;

      const updatedStateImages = [...currentState.stateImages];
      updatedStateImages[index] = {
        ...updatedStateImages[index],
        ...updates,
      } as StateImage;
      updateSelectedState({ stateImages: updatedStateImages });
    },
    [selectedNode, states, updateSelectedState]
  );

  const removeStateImage = useCallback(
    (index: number) => {
      if (!selectedNode) return;

      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState || !currentState.stateImages) return;

      const updatedStateImages = currentState.stateImages.filter(
        (_, i) => i !== index
      );
      updateSelectedState({ stateImages: updatedStateImages });
    },
    [selectedNode, states, updateSelectedState]
  );

  const moveStateImage = useCallback(
    (stateImageIndex: number, targetStateId: string) => {
      if (!selectedNode) return;

      const sourceState = states.find((s) => s.id === selectedNode);
      const targetState = states.find((s) => s.id === targetStateId);
      if (!sourceState || !targetState) return;
      if (
        !sourceState.stateImages ||
        stateImageIndex >= sourceState.stateImages.length
      )
        return;

      const stateImageToMove = sourceState.stateImages[stateImageIndex];
      if (!stateImageToMove) return;

      // Remove from source state
      const updatedSourceStateImages = sourceState.stateImages.filter(
        (_, i) => i !== stateImageIndex
      );
      updateState({
        ...sourceState,
        stateImages: updatedSourceStateImages,
      });

      // Add to target state
      const updatedTargetStateImages: typeof sourceState.stateImages = [
        ...(targetState.stateImages || []),
        stateImageToMove,
      ];
      updateState({
        ...targetState,
        stateImages: updatedTargetStateImages,
      });
    },
    [selectedNode, states, updateState]
  );

  // ========================================================================
  // Region management
  // ========================================================================

  const addRegion = useCallback(() => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const regions = currentState.regions || [];
    const newRegion: StateRegion = {
      id: `region-${Date.now()}`,
      name: `Region ${regions.length + 1}`,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      monitors: [0],
    };
    updateSelectedState({ regions: [...regions, newRegion] });
  }, [selectedNode, states, updateSelectedState]);

  const updateRegion = useCallback(
    (index: number, field: keyof StateRegion, value: unknown) => {
      if (!selectedNode) return;
      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState) return;

      const regions = currentState.regions || [];
      const updatedRegions = [...regions];
      updatedRegions[index] = {
        ...updatedRegions[index],
        [field]: value,
      } as StateRegion;
      updateSelectedState({ regions: updatedRegions });
    },
    [selectedNode, states, updateSelectedState]
  );

  const removeRegion = useCallback(
    (index: number) => {
      if (!selectedNode) return;
      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState) return;

      const regions = currentState.regions || [];
      const updatedRegions = regions.filter((_, i) => i !== index);
      updateSelectedState({ regions: updatedRegions });
    },
    [selectedNode, states, updateSelectedState]
  );

  // ========================================================================
  // Location management
  // ========================================================================

  const addLocation = useCallback(() => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const locations = currentState.locations || [];
    const newLocation: StateLocation = {
      id: `location-${Date.now()}`,
      name: `Location ${locations.length + 1}`,
      x: 0,
      y: 0,
      fixed: true,
      anchor: false,
      offsetX: 0,
      offsetY: 0,
      monitors: [0],
    };
    updateSelectedState({ locations: [...locations, newLocation] });
  }, [selectedNode, states, updateSelectedState]);

  const updateLocation = useCallback(
    (index: number, field: keyof StateLocation, value: unknown) => {
      if (!selectedNode) return;
      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState) return;

      const locations = currentState.locations || [];
      const updatedLocations = [...locations];
      updatedLocations[index] = {
        ...updatedLocations[index],
        [field]: value,
      } as StateLocation;
      updateSelectedState({ locations: updatedLocations });
    },
    [selectedNode, states, updateSelectedState]
  );

  const removeLocation = useCallback(
    (index: number) => {
      if (!selectedNode) return;
      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState) return;

      const locations = currentState.locations || [];
      const updatedLocations = locations.filter((_, i) => i !== index);
      updateSelectedState({ locations: updatedLocations });
    },
    [selectedNode, states, updateSelectedState]
  );

  // ========================================================================
  // String management
  // ========================================================================

  const addString = useCallback(() => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const strings = currentState.strings || [];
    const newString: StateString = {
      id: `string-${Date.now()}`,
      name: `String ${strings.length + 1}`,
      value: "",
      inputText: true,
    };
    updateSelectedState({ strings: [...strings, newString] });
  }, [selectedNode, states, updateSelectedState]);

  const updateString = useCallback(
    (index: number, field: keyof StateString, value: unknown) => {
      if (!selectedNode) return;
      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState) return;

      const strings = currentState.strings || [];
      const updatedStrings = [...strings];
      updatedStrings[index] = {
        ...updatedStrings[index],
        [field]: value,
      } as StateString;
      updateSelectedState({ strings: updatedStrings });
    },
    [selectedNode, states, updateSelectedState]
  );

  const removeString = useCallback(
    (index: number) => {
      if (!selectedNode) return;
      const currentState = states.find((s) => s.id === selectedNode);
      if (!currentState) return;

      const strings = currentState.strings || [];
      const updatedStrings = strings.filter((_, i) => i !== index);
      updateSelectedState({ strings: updatedStrings });
    },
    [selectedNode, states, updateSelectedState]
  );

  return {
    addStateImage,
    updateStateImage,
    removeStateImage,
    moveStateImage,
    addRegion,
    updateRegion,
    removeRegion,
    addLocation,
    updateLocation,
    removeLocation,
    addString,
    updateString,
    removeString,
  };
}
