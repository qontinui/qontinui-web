import { useState } from "react";
import type { StateImage, DiscoveredState } from "@/types/stateDiscovery";

export function useSelectionState() {
  const [selectedStateImage, setSelectedStateImage] =
    useState<StateImage | null>(null);
  const [selectedState, setSelectedState] = useState<DiscoveredState | null>(
    null
  );
  const [selectedStateImages, setSelectedStateImages] = useState<Set<string>>(
    new Set()
  );
  const [highlightedStateImages, setHighlightedStateImages] = useState<
    string[]
  >([]);

  return {
    selectedStateImage,
    setSelectedStateImage,
    selectedState,
    setSelectedState,
    selectedStateImages,
    setSelectedStateImages,
    highlightedStateImages,
    setHighlightedStateImages,
  };
}
