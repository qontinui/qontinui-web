/**
 * Hook that encapsulates all side-effect logic for StateDiscoveryTab.
 * Keeps the orchestrator focused on composition rather than effect management.
 */

import { useEffect } from "react";
import type { StateImage, DiscoveredState } from "@/types/stateDiscovery";
import type { Dimensions } from "../state-discovery-types";

interface UseStateDiscoveryEffectsParams {
  // Screenshot dimension loading
  selectedScreenshotUrl: string;
  setScreenshotDimensions: (dims: Dimensions) => void;

  // Reset selected state when filtered out
  selectedState: DiscoveredState | null;
  filteredStates: DiscoveredState[];
  setSelectedState: (state: DiscoveredState | null) => void;

  // Auto-highlight state images when a state is selected
  rightPanelTab: "stateimage" | "state";
  setHighlightedStateImages: (ids: string[]) => void;

  // Reset selected state image when filtered out
  selectedStateImage: StateImage | null;
  filteredStateImages: StateImage[];
  setSelectedStateImage: (si: StateImage | null) => void;
}

export function useStateDiscoveryEffects(
  params: UseStateDiscoveryEffectsParams
) {
  const {
    selectedScreenshotUrl,
    setScreenshotDimensions,
    selectedState,
    filteredStates,
    setSelectedState,
    rightPanelTab,
    setHighlightedStateImages,
    selectedStateImage,
    filteredStateImages,
    setSelectedStateImage,
  } = params;

  // Load screenshot dimensions when selected screenshot changes
  useEffect(() => {
    if (selectedScreenshotUrl) {
      const img = new Image();
      img.onload = () => {
        setScreenshotDimensions({ width: img.width, height: img.height });
      };
      img.src = selectedScreenshotUrl;
    }
  }, [selectedScreenshotUrl, setScreenshotDimensions]);

  // Reset selected state if it has been filtered out
  useEffect(() => {
    if (
      selectedState &&
      !filteredStates.find((s) => s.id === selectedState.id)
    ) {
      setSelectedState(null);
    }
  }, [filteredStates, selectedState, setSelectedState]);

  // Auto-highlight state images when a state is selected
  useEffect(() => {
    if (selectedState && rightPanelTab === "state") {
      const stateImageIds = selectedState.stateImageIds || [];
      setHighlightedStateImages(stateImageIds);
    } else {
      setHighlightedStateImages([]);
    }
  }, [selectedState, rightPanelTab, setHighlightedStateImages]);

  // Reset selected state image if it has been filtered out
  useEffect(() => {
    if (
      selectedStateImage &&
      !filteredStateImages.find((si) => si.id === selectedStateImage.id)
    ) {
      setSelectedStateImage(null);
    }
  }, [filteredStateImages, selectedStateImage, setSelectedStateImage]);
}
