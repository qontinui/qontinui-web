/**
 * Background Removal Tab Component
 * Allows users to remove backgrounds from screenshots for State Discovery
 */

import React from "react";
import { Badge } from "@/components/ui/badge";
import { useBackgroundRemoval } from "./_hooks/useBackgroundRemoval";
import { ConfigurationPanel } from "./_components/ConfigurationPanel";
import { PreviewPanel } from "./_components/PreviewPanel";
import { ResultsPanel } from "./_components/ResultsPanel";

export const BackgroundRemovalTab: React.FC = () => {
  const {
    selectedScreenshotIds,
    selectedScreenshotIndex,
    setSelectedScreenshotIndex,
    selectedScreenshots,
    selectedScreenshot,
    config,
    setConfig,
    result,
    isProcessing,
    error,
    activePreset,
    showAdvanced,
    setShowAdvanced,
    handleScreenshotsSelected,
    handlePresetChange,
    handleRemoveBackground,
    handleDownloadResults,
  } = useBackgroundRemoval();

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      {/* Header */}
      <div className="bg-surface-raised border-b border-border-default px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Background Removal
            </h1>
            <p className="text-text-muted mt-1">
              Remove dynamic backgrounds from screenshots for robust State
              Discovery
            </p>
          </div>
          <Badge
            variant="outline"
            className="bg-amber-900/20 text-amber-400 border-amber-600"
          >
            Experimental
          </Badge>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <ConfigurationPanel
          selectedScreenshotIds={selectedScreenshotIds}
          selectedScreenshotCount={selectedScreenshots.length}
          config={config}
          setConfig={setConfig}
          activePreset={activePreset}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          isProcessing={isProcessing}
          onScreenshotsSelected={handleScreenshotsSelected}
          onPresetChange={handlePresetChange}
          onRemoveBackground={handleRemoveBackground}
        />

        <PreviewPanel
          selectedScreenshots={selectedScreenshots}
          selectedScreenshotIndex={selectedScreenshotIndex}
          setSelectedScreenshotIndex={setSelectedScreenshotIndex}
          selectedScreenshot={selectedScreenshot}
          result={result}
        />

        <ResultsPanel
          result={result}
          error={error}
          onDownloadResults={handleDownloadResults}
        />
      </div>
    </div>
  );
};
