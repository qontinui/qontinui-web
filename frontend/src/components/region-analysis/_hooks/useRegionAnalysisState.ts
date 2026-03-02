import { useState } from "react";
import type {
  RegionAnalysisResponse,
  FusedRegion,
  DetectedRegion,
} from "@/services/regionAnalysis";

export function useRegionAnalysisState(results: RegionAnalysisResponse) {
  const [selectedView, setSelectedView] = useState<"fused" | "individual">(
    "fused"
  );
  const [selectedAnalyzer, setSelectedAnalyzer] = useState<string | null>(null);
  const [visibleSources, setVisibleSources] = useState<Set<string>>(new Set());
  const [selectedRegion, setSelectedRegion] = useState<
    FusedRegion | DetectedRegion | null
  >(null);
  const [showGridCells, setShowGridCells] = useState(true);
  const [showCellNumbers, setShowCellNumbers] = useState(true);
  const [zoom, setZoom] = useState(1);

  const toggleSource = (source: string) => {
    const newVisible = new Set(visibleSources);
    if (newVisible.has(source)) {
      newVisible.delete(source);
    } else {
      newVisible.add(source);
    }
    setVisibleSources(newVisible);
  };

  const regionsToDisplay =
    selectedView === "fused"
      ? results.fused_regions || []
      : selectedAnalyzer
        ? results.analyzer_results.find(
            (r) => r.analyzer_name === selectedAnalyzer
          )?.regions || []
        : [];

  const totalGridCells = regionsToDisplay.reduce((sum, region) => {
    return sum + (region.grid_metadata?.cells.length || 0);
  }, 0);

  return {
    selectedView,
    setSelectedView,
    selectedAnalyzer,
    setSelectedAnalyzer,
    visibleSources,
    toggleSource,
    selectedRegion,
    setSelectedRegion,
    showGridCells,
    setShowGridCells,
    showCellNumbers,
    setShowCellNumbers,
    zoom,
    setZoom,
    regionsToDisplay,
    totalGridCells,
  };
}
