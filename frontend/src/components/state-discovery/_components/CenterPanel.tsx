"use client";

/**
 * Center panel for the State Discovery tab.
 * Contains: view mode tabs, zoom controls, bulk selection actions,
 * and either the visualization canvas or region selector.
 */

import React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Upload } from "lucide-react";

import VisualizationCanvas from "../VisualizationCanvas";
import RegionSelector from "../RegionSelector";
import type { CenterPanelProps } from "../state-discovery-types";

const CenterPanel: React.FC<CenterPanelProps> = ({
  // View mode
  viewMode,
  onViewModeChange,
  // Canvas zoom
  canvasScale,
  onCanvasScaleChange,
  canvasImageSize,
  onCanvasImageSizeChange,
  // Selection
  selectedStateImages,
  onClearSelection,
  onBulkDelete,
  // Region selector
  showRegionSelector,
  selectedScreenshotUrl,
  screenshotDimensions,
  selectedRegion,
  onRegionSelect,
  // Canvas
  screenshots,
  selectedScreenshotIndex,
  stateImages,
  selectedStateImage,
  highlightedStateImages,
  maxDarkPixelPercentage,
  maxLightPixelPercentage,
  onSelectStateImage,
  onMultiSelectStateImage,
}) => {
  return (
    <div className="flex-1 p-4 overflow-hidden">
      <div className="h-full flex flex-col">
        {/* View Controls */}
        <div className="flex items-center gap-4 mb-4">
          <Tabs
            value={viewMode}
            onValueChange={(v) =>
              onViewModeChange(v as "all" | "selected" | "state")
            }
          >
            <TabsList>
              <TabsTrigger value="all">All StateImages</TabsTrigger>
              <TabsTrigger value="selected">Selected Only</TabsTrigger>
              <TabsTrigger value="state">Current State</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Zoom controls */}
          <div className="flex items-center gap-2 bg-surface-canvas border border-border-default rounded-lg px-2 py-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 hover:bg-surface-raised text-text-secondary"
              onClick={() => onCanvasScaleChange((s) => Math.max(s * 0.8, 0.1))}
            >
              <span className="text-lg">&minus;</span>
            </Button>
            <span className="text-sm font-medium px-2 text-text-secondary">
              {Math.round(canvasScale * 100)}%
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 hover:bg-surface-raised text-text-secondary"
              onClick={() => onCanvasScaleChange((s) => Math.min(s * 1.2, 3))}
            >
              <span className="text-lg">+</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 hover:bg-surface-raised text-text-secondary"
              onClick={() => onCanvasScaleChange(1)}
            >
              Fit
            </Button>
          </div>

          {selectedStateImages.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-text-muted">
                {selectedStateImages.size} selected
              </span>
              <Button size="sm" variant="outline" onClick={onClearSelection}>
                Clear Selection
              </Button>
              <DestructiveButton size="sm" onClick={onBulkDelete}>
                Delete Selected
              </DestructiveButton>
            </div>
          )}
        </div>

        {/* Canvas or Region Selector - width adjusts based on zoom */}
        {showRegionSelector && selectedScreenshotUrl ? (
          <div className="flex-1">
            <RegionSelector
              imageUrl={selectedScreenshotUrl}
              imageWidth={screenshotDimensions.width}
              imageHeight={screenshotDimensions.height}
              onRegionSelect={(region) => onRegionSelect(region ?? null)}
              initialRegion={selectedRegion ?? undefined}
            />
          </div>
        ) : (
          <div
            className="border border-border-subtle rounded-lg overflow-auto bg-surface-canvas"
            style={{
              flex: canvasScale < 0.8 ? "0 0 auto" : "1",
              width:
                canvasScale < 0.8
                  ? `${canvasImageSize.width * canvasScale + 40}px`
                  : undefined,
              minWidth: "300px",
            }}
          >
            {screenshots.length > 0 && screenshots[selectedScreenshotIndex] ? (
              <VisualizationCanvas
                screenshot={screenshots[selectedScreenshotIndex]!}
                stateImages={stateImages}
                selectedStateImage={selectedStateImage}
                selectedStateImages={selectedStateImages}
                highlightedStateImages={highlightedStateImages}
                viewMode={viewMode}
                onSelectStateImage={onSelectStateImage}
                onMultiSelectStateImage={onMultiSelectStateImage}
                screenshotIndex={selectedScreenshotIndex}
                maxDarkPixelPercentage={maxDarkPixelPercentage}
                maxLightPixelPercentage={maxLightPixelPercentage}
                scale={canvasScale}
                onScaleChange={onCanvasScaleChange}
                onImageSizeChange={onCanvasImageSizeChange}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted">
                <div className="text-center">
                  <Upload className="h-12 w-12 mx-auto mb-4" />
                  <p>Upload screenshots to begin</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CenterPanel;
