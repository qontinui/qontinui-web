import { useState } from "react";

export function useRegionSelection() {
  const [selectedRegion, setSelectedRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [showRegionSelector, setShowRegionSelector] = useState(false);

  return {
    selectedRegion,
    setSelectedRegion,
    showRegionSelector,
    setShowRegionSelector,
  };
}
