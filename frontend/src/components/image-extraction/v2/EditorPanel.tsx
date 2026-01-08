/**
 * Editor Panel
 *
 * Main editing area - displays either the composite canvas for multi-monitor
 * screenshots or the advanced region selector for single screenshots.
 */

import React, { useCallback, useMemo } from "react";
import { ImageIcon } from "lucide-react";
import { AdvancedRegionSelector } from "@/components/pattern-optimization/AdvancedRegionSelector";
import { CompositeScreenshotCanvas } from "../CompositeScreenshotCanvas";
import type { Region } from "@/types/pattern-optimization";
import type {
  ScreenshotData,
  CompositeScreenshotData,
  ViewportState,
} from "@/hooks/use-image-extraction";

interface EditorPanelProps {
  currentScreenshot: ScreenshotData | null;
  compositeScreenshots: CompositeScreenshotData[];
  isCompositeMode: boolean;
  selectedRegion: Region | null;
  onRegionChange: (region: Region | null) => void;
  viewport: ViewportState;
  onViewportChange: (viewport: Partial<ViewportState>) => void;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  currentScreenshot,
  compositeScreenshots,
  isCompositeMode,
  selectedRegion,
  onRegionChange,
  viewport,
  onViewportChange,
}) => {
  // Handle region change from AdvancedRegionSelector
  const handleRegionChange = useCallback(
    (region: Region) => {
      onRegionChange(region);
    },
    [onRegionChange]
  );

  // Handle region change from CompositeScreenshotCanvas - memoized to prevent re-renders
  const handleCompositeRegionChange = useCallback(
    (region: Region) => {
      onRegionChange(region);
    },
    [onRegionChange]
  );

  // Convert composite screenshots to display format (with url instead of dataUrl)
  // Memoize to prevent unnecessary re-renders that reset zoom state
  const compositeDisplayScreenshots = useMemo(
    () =>
      compositeScreenshots.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.dataUrl,
        monitor: s.monitor,
      })),
    [compositeScreenshots]
  );

  return (
    <div className="flex-1 h-full bg-surface-canvas">
      {isCompositeMode && compositeScreenshots.length > 0 ? (
        <CompositeScreenshotCanvas
          screenshots={compositeDisplayScreenshots}
          region={selectedRegion ?? undefined}
          onRegionChange={handleCompositeRegionChange}
          zoom={viewport.zoom}
          panX={viewport.panX}
          panY={viewport.panY}
          onViewportChange={onViewportChange}
        />
      ) : currentScreenshot ? (
        <AdvancedRegionSelector
          screenshotId={currentScreenshot.id}
          screenshotUrl={currentScreenshot.dataUrl}
          region={selectedRegion ?? undefined}
          onRegionChange={handleRegionChange}
          zoom={viewport.zoom}
          panX={viewport.panX}
          panY={viewport.panY}
          onViewportChange={onViewportChange}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-text-muted">
          <div className="text-center">
            <ImageIcon className="w-12 h-12 mx-auto mb-2" />
            <p className="text-sm">Upload or select a screenshot to begin</p>
          </div>
        </div>
      )}
    </div>
  );
};
