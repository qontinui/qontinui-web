"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { useDirectPatternScreenshots } from "./_hooks/useDirectPatternScreenshots";
import { usePatternExtraction } from "./_hooks/usePatternExtraction";
import { usePatternSaving } from "./_hooks/usePatternSaving";
import SnapshotSelectionStep from "./_components/SnapshotSelectionStep";
import PatternExtractionStep from "./_components/PatternExtractionStep";
import PatternSaveStep from "./_components/PatternSaveStep";

export function DirectPatternCreation() {
  const {
    selectedSnapshots,
    setSelectedSnapshots,
    screenshots,
    loadingScreenshots,
    currentScreenshotIndex,
    currentScreenshot,
    selectedRegion,
    setSelectedRegion,
    goToPrevious,
    goToNext,
  } = useDirectPatternScreenshots();

  const {
    extractedPatterns,
    extracting,
    existingRegions,
    handleExtractRegion,
    handleDeletePattern,
    handleUpdatePattern,
    clearPatterns,
  } = usePatternExtraction({
    screenshots,
    currentScreenshotIndex,
    selectedRegion,
    setSelectedRegion,
  });

  const { saving, saveProgress, handleSavePatterns } = usePatternSaving({
    extractedPatterns,
    clearPatterns,
    clearSnapshots: () => setSelectedSnapshots([]),
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-6 w-6 text-purple-600" />
        <div>
          <h2 className="text-2xl font-bold">Direct Pattern Creation</h2>
          <p className="text-sm text-text-muted">
            Extract patterns directly from snapshots without uploading
            screenshots
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          EXPERIMENTAL
        </Badge>
      </div>

      <SnapshotSelectionStep
        selectedSnapshots={selectedSnapshots}
        onChangeSnapshots={setSelectedSnapshots}
        loadingScreenshots={loadingScreenshots}
        screenshotCount={screenshots.length}
      />

      {screenshots.length > 0 && (
        <PatternExtractionStep
          screenshots={screenshots}
          currentScreenshotIndex={currentScreenshotIndex}
          currentScreenshot={currentScreenshot}
          selectedRegion={selectedRegion}
          onRegionSelected={setSelectedRegion}
          existingRegions={existingRegions}
          extracting={extracting}
          extractedPatterns={extractedPatterns}
          onExtractRegion={handleExtractRegion}
          onDeletePattern={handleDeletePattern}
          onUpdatePattern={handleUpdatePattern}
          onPrevious={goToPrevious}
          onNext={goToNext}
        />
      )}

      {extractedPatterns.length > 0 && (
        <PatternSaveStep
          patternCount={extractedPatterns.length}
          saving={saving}
          saveProgress={saveProgress}
          onSave={handleSavePatterns}
        />
      )}
    </div>
  );
}
