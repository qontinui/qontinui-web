/**
 * State Discovery Tab Component
 * Main orchestrator for the State Discovery feature.
 *
 * All UI rendering is delegated to sub-components in _components/.
 * State is managed via custom hooks in _hooks/.
 * Pure logic lives in state-discovery-utils.ts.
 */

import React, { useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

import { HeaderBar, LeftPanel, CenterPanel, RightPanel } from "./_components";
import {
  useScreenshots,
  useSelectionState,
  useAnalysisState,
  useViewConfig,
  useFilterConfig,
  useRegionSelection,
  useStateDiscoveryActions,
  useStateDiscoveryEffects,
} from "./_hooks";
import {
  filterStateImagesByPixels,
  filterStatesByVisibleImages,
  isPixelFilterActive,
} from "./state-discovery-utils";

import AnalysisProgress from "./AnalysisProgress";
import { useStateDiscovery } from "@/hooks/useStateDiscovery";
import { useAutomation } from "@/contexts/automation-context";
import {
  createImageAsset,
  imageExistsInLibrary,
} from "@/lib/image-library-utils";

const StateDiscoveryTab: React.FC = () => {
  // --- Grouped state hooks ---
  const screenshotState = useScreenshots();
  const selectionState = useSelectionState();
  const analysisState = useAnalysisState();
  const viewConfig = useViewConfig();
  const filterConfig = useFilterConfig();
  const regionSelection = useRegionSelection();

  // --- External hooks ---
  const {
    uploadScreenshots,
    startAnalysis,
    deleteStateImage,
    bulkDeleteStateImages,
    saveStructure,
    stateImages,
    states,
    analysisResult,
    uploadId: uploadIdRaw,
    error,
  } = useStateDiscovery();

  const uploadId = uploadIdRaw as string | null | undefined;
  const { images, addImage } = useAutomation();

  // --- Derived data ---
  const filterActive = isPixelFilterActive(
    filterConfig.maxDarkPixelPercentage,
    filterConfig.maxLightPixelPercentage
  );

  const filteredStateImages = useMemo(
    () =>
      filterStateImagesByPixels(
        stateImages,
        filterConfig.maxDarkPixelPercentage,
        filterConfig.maxLightPixelPercentage
      ),
    [
      stateImages,
      filterConfig.maxDarkPixelPercentage,
      filterConfig.maxLightPixelPercentage,
    ]
  );

  const filteredStates = useMemo(
    () => filterStatesByVisibleImages(states, filteredStateImages),
    [states, filteredStateImages]
  );

  const selectedScreenshotUrl = useMemo(() => {
    const { screenshots, selectedScreenshotIndex } = screenshotState;
    if (
      screenshots.length > 0 &&
      selectedScreenshotIndex < screenshots.length
    ) {
      const screenshot = screenshots[selectedScreenshotIndex];
      if (screenshot) {
        return URL.createObjectURL(screenshot);
      }
    }
    return "";
  }, [screenshotState.screenshots, screenshotState.selectedScreenshotIndex]);

  // --- Side effects ---
  useStateDiscoveryEffects({
    selectedScreenshotUrl,
    setScreenshotDimensions: screenshotState.setScreenshotDimensions,
    selectedState: selectionState.selectedState,
    filteredStates,
    setSelectedState: selectionState.setSelectedState,
    rightPanelTab: viewConfig.rightPanelTab,
    setHighlightedStateImages: selectionState.setHighlightedStateImages,
    selectedStateImage: selectionState.selectedStateImage,
    filteredStateImages,
    setSelectedStateImage: selectionState.setSelectedStateImage,
  });

  // --- Action handlers ---
  const {
    handleScreenshotUpload,
    handleStartAnalysis,
    handleStateImageSelect,
    handleStateImageMultiSelect,
    handleDeleteStateImage,
    handleBulkDelete,
    handleSaveStructure,
    handleSelectState,
  } = useStateDiscoveryActions({
    setScreenshots: screenshotState.setScreenshots,
    setSelectedStateImage: selectionState.setSelectedStateImage,
    setSelectedState: selectionState.setSelectedState,
    setSelectedStateImages: selectionState.setSelectedStateImages,
    setIsAnalyzing: analysisState.setIsAnalyzing,
    setAnalysisProgress: analysisState.setAnalysisProgress,
    setRightPanelTab: viewConfig.setRightPanelTab,
    screenshots: screenshotState.screenshots,
    uploadId,
    selectedStateImage: selectionState.selectedStateImage,
    selectedStateImages: selectionState.selectedStateImages,
    similarityThreshold: filterConfig.similarityThreshold,
    selectedRegion: regionSelection.selectedRegion,
    filterActive,
    filteredStates,
    filteredStateImages,
    images,
    addImage,
    uploadScreenshots,
    startAnalysis,
    deleteStateImage,
    bulkDeleteStateImages,
    saveStructure,
    imageExistsInLibrary,
    createImageAsset,
  });

  // --- Render ---
  return (
    <div className="flex flex-col h-full">
      <HeaderBar
        onSaveStructure={handleSaveStructure}
        analysisResult={analysisResult}
        filteredStateImagesCount={filteredStateImages.length}
        isFilterActive={filterActive}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftPanel
          screenshots={screenshotState.screenshots}
          selectedScreenshotIndex={screenshotState.selectedScreenshotIndex}
          onSelectScreenshot={screenshotState.setSelectedScreenshotIndex}
          onScreenshotUpload={handleScreenshotUpload}
          similarityThreshold={filterConfig.similarityThreshold}
          onSimilarityThresholdChange={filterConfig.setSimilarityThreshold}
          showRegionSelector={regionSelection.showRegionSelector}
          onToggleRegionSelector={() =>
            regionSelection.setShowRegionSelector(
              !regionSelection.showRegionSelector
            )
          }
          selectedRegion={regionSelection.selectedRegion}
          onClearRegion={() => regionSelection.setSelectedRegion(null)}
          onStartAnalysis={handleStartAnalysis}
          uploadId={uploadId}
          isAnalyzing={analysisState.isAnalyzing}
          analysisProgress={analysisState.analysisProgress}
          analysisResult={analysisResult}
          filteredStates={filteredStates}
          filteredStateImages={filteredStateImages}
          allStatesCount={states?.length}
          allStateImagesCount={stateImages?.length}
          selectedState={selectionState.selectedState}
          onSelectState={handleSelectState}
          stateImages={stateImages}
          maxDarkPixelPercentage={filterConfig.maxDarkPixelPercentage}
          onMaxDarkPixelPercentageChange={
            filterConfig.setMaxDarkPixelPercentage
          }
          maxLightPixelPercentage={filterConfig.maxLightPixelPercentage}
          onMaxLightPixelPercentageChange={
            filterConfig.setMaxLightPixelPercentage
          }
          onResetFilters={() => {
            filterConfig.setMaxDarkPixelPercentage(100);
            filterConfig.setMaxLightPixelPercentage(100);
          }}
          isFilterActive={filterActive}
        />

        <CenterPanel
          viewMode={viewConfig.viewMode}
          onViewModeChange={viewConfig.setViewMode}
          canvasScale={viewConfig.canvasScale}
          onCanvasScaleChange={viewConfig.setCanvasScale}
          canvasImageSize={viewConfig.canvasImageSize}
          onCanvasImageSizeChange={viewConfig.setCanvasImageSize}
          selectedStateImages={selectionState.selectedStateImages}
          onClearSelection={() =>
            selectionState.setSelectedStateImages(new Set())
          }
          onBulkDelete={handleBulkDelete}
          showRegionSelector={regionSelection.showRegionSelector}
          selectedScreenshotUrl={selectedScreenshotUrl}
          screenshotDimensions={screenshotState.screenshotDimensions}
          selectedRegion={regionSelection.selectedRegion}
          onRegionSelect={(region) => regionSelection.setSelectedRegion(region)}
          screenshots={screenshotState.screenshots}
          selectedScreenshotIndex={screenshotState.selectedScreenshotIndex}
          stateImages={stateImages}
          selectedStateImage={selectionState.selectedStateImage}
          highlightedStateImages={selectionState.highlightedStateImages}
          maxDarkPixelPercentage={filterConfig.maxDarkPixelPercentage}
          maxLightPixelPercentage={filterConfig.maxLightPixelPercentage}
          onSelectStateImage={handleStateImageSelect}
          onMultiSelectStateImage={handleStateImageMultiSelect}
        />

        <RightPanel
          rightPanelTab={viewConfig.rightPanelTab}
          onRightPanelTabChange={viewConfig.setRightPanelTab}
          selectedStateImage={selectionState.selectedStateImage}
          screenshots={screenshotState.screenshots}
          filteredStates={filteredStates}
          onDeleteStateImage={handleDeleteStateImage}
          selectedState={selectionState.selectedState}
          filteredStateImages={filteredStateImages}
          selectedScreenshotIndex={screenshotState.selectedScreenshotIndex}
          onSelectScreenshot={screenshotState.setSelectedScreenshotIndex}
          onHighlightStateImages={selectionState.setHighlightedStateImages}
        />
      </div>

      {/* Error Display */}
      {error && (
        <Alert className="m-4" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Progress Modal */}
      {analysisState.isAnalyzing && (
        <AnalysisProgress
          progress={analysisState.analysisProgress}
          onCancel={() => analysisState.setIsAnalyzing(false)}
        />
      )}
    </div>
  );
};

export default StateDiscoveryTab;
