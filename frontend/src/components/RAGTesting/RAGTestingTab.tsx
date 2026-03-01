"use client";

import React, { useCallback } from "react";
import { ScreenshotPicker } from "@/components/common/ScreenshotPicker";
import { useAutomation } from "@/contexts/automation-context";
import {
  useRAGScreenshot,
  useRAGSearchConfig,
  useRAGDisplay,
  useRAGCanvas,
  useRAGAnalysis,
} from "./_hooks";
import {
  SearchModePanel,
  MatchingOptionsPanel,
  DisplayOptionsPanel,
  ResultsSummaryPanel,
  CanvasToolbar,
  SegmentCanvas,
  SegmentDetailsPanel,
  SegmentListPanel,
} from "./_components";

export function RAGTestingTab() {
  // Context
  const { screenshots, projectId } = useAutomation();

  // Search configuration state
  const searchConfig = useRAGSearchConfig();

  // Display options state
  const display = useRAGDisplay();

  // Screenshot state
  const screenshot = useRAGScreenshot(screenshots);

  // Analysis state (segments, matches, RAG elements, run logic)
  const analysis = useRAGAnalysis({
    projectId,
    currentScreenshot: screenshot.currentScreenshot,
    searchMode: searchConfig.searchMode,
    selectedElementIds: searchConfig.selectedElementIds,
    similarityThreshold: searchConfig.similarityThreshold,
    matchingStrategy: searchConfig.matchingStrategy,
    useOCR: searchConfig.useOCR,
  });

  // Canvas interaction state (zoom, pan, mouse handlers)
  const canvas = useRAGCanvas({
    segments: analysis.segments,
    setSelectedSegmentId: analysis.setSelectedSegmentId,
    setHoveredSegmentId: analysis.setHoveredSegmentId,
    currentScreenshotUrl: screenshot.currentScreenshot?.url,
  });

  // Wire screenshot handlers to reset analysis results
  const handleUploadScreenshot = useCallback(
    (file: File) => {
      screenshot.handleUploadScreenshot(file, () => {
        analysis.resetResults();
      });
    },
    [screenshot, analysis]
  );

  const handleSelectProjectScreenshot = useCallback(
    (screenshotId: string) => {
      screenshot.handleSelectProjectScreenshot(screenshotId, () => {
        analysis.resetResults();
      });
    },
    [screenshot, analysis]
  );

  const handleClearScreenshot = useCallback(() => {
    screenshot.handleClearScreenshot(() => {
      analysis.resetResults();
    });
  }, [screenshot, analysis]);

  return (
    <div className="h-full flex bg-surface-canvas">
      {/* Left Panel - Controls */}
      <div className="w-80 border-r border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          {/* Screenshot Selection */}
          <ScreenshotPicker
            currentScreenshot={screenshot.currentScreenshot}
            onUploadScreenshot={handleUploadScreenshot}
            onSelectProjectScreenshot={handleSelectProjectScreenshot}
            onClearScreenshot={handleClearScreenshot}
            enableCapture={true}
            className="bg-surface-raised/50 border border-border-default rounded-lg"
          />

          <SearchModePanel
            isSegmentationOnly={analysis.isSegmentationOnly}
            searchMode={searchConfig.searchMode}
            setSearchMode={searchConfig.setSearchMode}
            selectedElementIds={searchConfig.selectedElementIds}
            setSelectedElementIds={searchConfig.setSelectedElementIds}
            toggleElementSelection={searchConfig.toggleElementSelection}
            elementSelectorOpen={analysis.elementSelectorOpen}
            setElementSelectorOpen={analysis.setElementSelectorOpen}
            ragElements={analysis.ragElements}
            loadingElements={analysis.loadingElements}
          />

          <MatchingOptionsPanel
            isSegmentationOnly={analysis.isSegmentationOnly}
            matchingStrategy={searchConfig.matchingStrategy}
            setMatchingStrategy={searchConfig.setMatchingStrategy}
            similarityThreshold={searchConfig.similarityThreshold}
            setSimilarityThreshold={searchConfig.setSimilarityThreshold}
            useOCR={searchConfig.useOCR}
            setUseOCR={searchConfig.setUseOCR}
            isAnalyzing={analysis.isAnalyzing}
            hasScreenshot={!!screenshot.currentScreenshot?.url}
            onRunAnalysis={analysis.runAnalysis}
          />

          <DisplayOptionsPanel
            showSegmentation={display.showSegmentation}
            setShowSegmentation={display.setShowSegmentation}
            showLabels={display.showLabels}
            setShowLabels={display.setShowLabels}
            highlightMatches={display.highlightMatches}
            setHighlightMatches={display.setHighlightMatches}
          />

          <ResultsSummaryPanel
            segments={analysis.segments}
            allMatches={analysis.allMatches}
            processingTime={analysis.processingTime}
          />
        </div>
      </div>

      {/* Center Panel - Canvas */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-raised">
        <CanvasToolbar
          zoom={canvas.zoom}
          setZoom={canvas.setZoom}
          resetView={canvas.resetView}
        />

        <SegmentCanvas
          currentScreenshotUrl={screenshot.currentScreenshot?.url}
          segments={analysis.segments}
          selectedSegmentId={analysis.selectedSegmentId}
          hoveredSegmentId={analysis.hoveredSegmentId}
          showSegmentation={display.showSegmentation}
          showLabels={display.showLabels}
          highlightMatches={display.highlightMatches}
          maskImages={analysis.maskImages}
          zoom={canvas.zoom}
          pan={canvas.pan}
          canvasRef={canvas.canvasRef}
          containerRef={canvas.containerRef}
          handleCanvasClick={canvas.handleCanvasClick}
          handleCanvasMove={canvas.handleCanvasMove}
          handleMouseDown={canvas.handleMouseDown}
          handleMouseUp={canvas.handleMouseUp}
          handleWheel={canvas.handleWheel}
        />
      </div>

      {/* Right Panel - Details */}
      <div className="w-96 border-l border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <SegmentDetailsPanel selectedSegment={analysis.selectedSegment} />

          <SegmentListPanel
            segments={analysis.segments}
            selectedSegmentId={analysis.selectedSegmentId}
            setSelectedSegmentId={analysis.setSelectedSegmentId}
          />
        </div>
      </div>
    </div>
  );
}
