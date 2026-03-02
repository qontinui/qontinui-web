import React, { useState, useEffect } from "react";
import { createLogger } from "@/lib/logger";
import {
  PatternOptimizationProvider,
  usePatternOptimization,
} from "@/contexts/pattern-optimization-context-simplified";
import {
  type ExtractionConfig,
  type PatternQuality,
  type Region,
} from "@/types/pattern-optimization";
import { AdvancedRegionSelector } from "./AdvancedRegionSelector";
import { ChevronDown, ChevronUp, HelpCircle, ImageIcon } from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { ScreenshotSelector } from "../screenshot-selector";
import { usePatternOptimizationBridge } from "@/stores/page-state";
import { HowItWorksSection } from "./_components/HowItWorksSection";
import { ScreenshotListPanel } from "./_components/ScreenshotListPanel";
import { ExtractionConfigPanel } from "./_components/ExtractionConfigPanel";
import { ExtractionResultsPanel } from "./_components/ExtractionResultsPanel";
import { StateImageDialog } from "./_components/StateImageDialog";
import { usePatternCanvas } from "./_hooks/usePatternCanvas";
import { useScreenshotManagement } from "./_hooks/useScreenshotManagement";
import { useStateImageCreation } from "./_hooks/useStateImageCreation";

/**
 * Pattern Optimization Component - Simplified
 * Single Responsibility: UI for pattern extraction from screenshots
 */
const logger = createLogger("PatternOptimization");

const PatternOptimizationContent: React.FC = () => {
  const {
    session,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    setAllScreenshotRegions,
    extractPattern,
    isExtracting,
    extractedPattern,
    analyzePatternQuality,
  } = usePatternOptimization();

  const pageState = usePatternOptimizationBridge();

  const {
    states,
    addState,
    updateState,
    screenshots: projectScreenshots,
    images,
    addImage,
  } = useAutomation();

  const [patternQuality, setPatternQuality] = useState<PatternQuality | null>(
    null
  );
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Screenshot management (upload, selection, session init)
  const {
    fileInputRef,
    screenshotSelectorTriggerRef,
    selectedScreenshot,
    handleFileSelect,
    handleProjectScreenshotSelect,
  } = useScreenshotManagement({
    session,
    selectedScreenshotId: pageState.selectedScreenshotId,
    projectScreenshots,
    createSession,
    addScreenshots,
    setSelectedScreenshotId: pageState.setSelectedScreenshotId,
  });

  // Canvas editing for pattern transparency
  const {
    patternCanvasRef,
    cursorPos,
    brushRadius,
    handlePatternEdit,
    handlePatternMouseMove,
    handlePatternMouseLeave,
  } = usePatternCanvas({
    editMode: pageState.editMode,
    extractedPattern,
    editedPattern: pageState.editedPattern,
    onEditedPatternChange: pageState.setEditedPattern,
  });

  // StateImage creation dialog logic
  const { handleCreateStateImage, handleCancelDialog } = useStateImageCreation({
    extractedPattern,
    editedPattern: pageState.editedPattern,
    stateImageName: pageState.stateImageName,
    selectedStateId: pageState.selectedStateId,
    newStateName: pageState.newStateName,
    fixedLocation: pageState.fixedLocation,
    session,
    states,
    images,
    addImage,
    addState,
    updateState,
    setShowStateImageDialog: pageState.setShowStateImageDialog,
    setStateImageName: pageState.setStateImageName,
    setSelectedStateId: pageState.setSelectedStateId,
    setNewStateName: pageState.setNewStateName,
  });

  // Analyze pattern quality when extracted
  useEffect(() => {
    if (extractedPattern) {
      const quality = analyzePatternQuality(extractedPattern);
      setPatternQuality(quality);
    }
  }, [extractedPattern, analyzePatternQuality]);

  // Check if we can extract - need at least one screenshot with a region
  const hasRegions = session?.screenshots?.some((s) => s.region) || false;
  const hasRequirements =
    session && (session.screenshots?.length ?? 0) > 0 && hasRegions;
  const canExtract = hasRequirements && !isExtracting;

  const handleExtract = async () => {
    logger.debug("Extract clicked");
    logger.debug("Session:", session);
    logger.debug(
      "Screenshots with regions:",
      session?.screenshots.filter((s) => s.region)
    );
    logger.debug("Can extract?", canExtract);

    if (!canExtract) {
      logger.debug("Cannot extract - missing requirements");
      return;
    }

    try {
      const fullConfig: ExtractionConfig = {
        ...pageState.config,
        minActivePixels: 100,
      };
      await extractPattern(fullConfig);
    } catch (error) {
      logger.error("Pattern extraction failed:", error);
    }
  };

  const handleRegionChange = (region: Region) => {
    logger.debug("Region changed:", region);
    setAllScreenshotRegions(region);

    setTimeout(() => {
      logger.debug("After region update - checking state");
      logger.debug("Session screenshots:", session?.screenshots);
    }, 100);
  };

  // Debug logging
  useEffect(() => {
    if (session) {
      logger.debug("Session updated, checking regions:");
      session.screenshots.forEach((s) => {
        logger.debug(
          `  - ${s.id}: ${s.region ? "has region" : "no region"}`,
          s.region
        );
      });
      logger.debug("Can extract?", canExtract);
    }
  }, [session, canExtract]);

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      {/* Header */}
      <div className="bg-surface-raised border-b border-border-subtle px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Pattern Extraction
            </h1>
            <p className="text-text-muted mt-1">
              Create robust image patterns that ignore variable content like
              text, timestamps, or changing UI elements
            </p>
          </div>
          <button
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-white bg-surface-canvas rounded-md transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            How it works
            {showHowItWorks ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        {showHowItWorks && <HowItWorksSection />}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Screenshots */}
        <ScreenshotListPanel
          screenshots={session?.screenshots ?? []}
          selectedScreenshotId={pageState.selectedScreenshotId}
          onSelectScreenshot={(id) => pageState.setSelectedScreenshotId(id)}
          onRemoveScreenshot={removeScreenshot}
          onClearSession={clearSession}
          onUploadClick={() => fileInputRef.current?.click()}
          onProjectClick={() => screenshotSelectorTriggerRef.current?.click()}
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Middle Panel - Configuration and Screenshot Viewer */}
        <div className="flex-1 flex">
          <ExtractionConfigPanel
            config={pageState.config}
            onConfigChange={pageState.setConfig}
            canExtract={!!canExtract}
            isExtracting={isExtracting}
            hasRequirements={!!hasRequirements}
            hasScreenshots={(session?.screenshots?.length ?? 0) > 0}
            onExtract={handleExtract}
          />

          {/* Screenshot Viewer */}
          <div className="flex-1 bg-surface-canvas">
            {selectedScreenshot ? (
              <AdvancedRegionSelector
                screenshotId={selectedScreenshot.id}
                screenshotUrl={selectedScreenshot.url}
                region={selectedScreenshot.region}
                onRegionChange={handleRegionChange}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted">
                <div className="text-center">
                  <ImageIcon className="w-12 h-12 mx-auto mb-2" />
                  <p className="text-sm">Upload screenshots to begin</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Results */}
        <ExtractionResultsPanel
          extractedPattern={extractedPattern}
          patternQuality={patternQuality}
          editMode={pageState.editMode}
          editedPattern={pageState.editedPattern}
          patternCanvasRef={patternCanvasRef}
          cursorPos={cursorPos}
          brushRadius={brushRadius}
          onSetEditMode={pageState.setEditMode}
          onResetEditedPattern={() => pageState.setEditedPattern(null)}
          onShowStateImageDialog={() => pageState.setShowStateImageDialog(true)}
          onPatternEdit={handlePatternEdit}
          onPatternMouseMove={handlePatternMouseMove}
          onPatternMouseLeave={handlePatternMouseLeave}
        />
      </div>

      {/* StateImage Creation Dialog */}
      {pageState.showStateImageDialog && (
        <StateImageDialog
          stateImageName={pageState.stateImageName}
          selectedStateId={pageState.selectedStateId}
          newStateName={pageState.newStateName}
          fixedLocation={pageState.fixedLocation}
          editedPattern={pageState.editedPattern}
          states={states}
          onStateImageNameChange={pageState.setStateImageName}
          onSelectedStateIdChange={pageState.setSelectedStateId}
          onNewStateNameChange={pageState.setNewStateName}
          onFixedLocationChange={pageState.setFixedLocation}
          onCancel={handleCancelDialog}
          onConfirm={handleCreateStateImage}
        />
      )}

      {/* Screenshot Selector with multi-select */}
      <ScreenshotSelector
        selectedScreenshot=""
        onSelectScreenshot={() => {}}
        multiSelect={true}
        selectedScreenshots={[]}
        onSelectScreenshots={handleProjectScreenshotSelect}
        allowUpload={false}
        trigger={
          <button
            ref={screenshotSelectorTriggerRef}
            style={{ display: "none" }}
          />
        }
      />
    </div>
  );
};

/**
 * Pattern Optimization Component with Provider
 * Wraps the content with the PatternOptimizationProvider
 */
export const PatternOptimizationSimplified: React.FC = () => {
  return (
    <PatternOptimizationProvider>
      <PatternOptimizationContent />
    </PatternOptimizationProvider>
  );
};
