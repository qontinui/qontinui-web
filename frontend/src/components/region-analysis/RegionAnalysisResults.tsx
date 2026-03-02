"use client";

import type { RegionAnalysisResponse } from "@/services/regionAnalysis";
import { useRegionAnalysisState } from "./_hooks/useRegionAnalysisState";
import { SummaryCard } from "./_components/SummaryCard";
import { VisualizationCard } from "./_components/VisualizationCard";
import { RegionDetailsPanel } from "./_components/RegionDetailsPanel";
import { SelectedRegionDetails } from "./_components/SelectedRegionDetails";

interface RegionAnalysisResultsProps {
  results: RegionAnalysisResponse;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export function RegionAnalysisResults({
  results,
  imageUrl,
  imageWidth = 800,
  imageHeight = 600,
}: RegionAnalysisResultsProps) {
  const {
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
  } = useRegionAnalysisState(results);

  return (
    <div className="space-y-4">
      <SummaryCard results={results} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <VisualizationCard
          results={results}
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          selectedView={selectedView}
          setSelectedView={setSelectedView}
          selectedAnalyzer={selectedAnalyzer}
          setSelectedAnalyzer={setSelectedAnalyzer}
          showGridCells={showGridCells}
          setShowGridCells={setShowGridCells}
          showCellNumbers={showCellNumbers}
          setShowCellNumbers={setShowCellNumbers}
          zoom={zoom}
          setZoom={setZoom}
          regionsToDisplay={regionsToDisplay}
          totalGridCells={totalGridCells}
          visibleSources={visibleSources}
          toggleSource={toggleSource}
        />

        <RegionDetailsPanel
          results={results}
          regionsToDisplay={regionsToDisplay}
          totalGridCells={totalGridCells}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
        />
      </div>

      {selectedRegion && <SelectedRegionDetails region={selectedRegion} />}
    </div>
  );
}
