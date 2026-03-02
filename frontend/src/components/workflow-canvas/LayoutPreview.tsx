import React from "react";
import { useLayoutPreview } from "./_hooks/use-layout-preview";
import { PreviewControls } from "./_components/PreviewControls";
import { PreviewCanvasArea } from "./_components/PreviewCanvasArea";
import { PreviewStats } from "./_components/PreviewStats";
import type { LayoutPreviewProps } from "./layout-preview-types";

export type { LayoutPreviewProps } from "./layout-preview-types";

export function LayoutPreview({
  beforeWorkflow,
  afterWorkflow,
  comparison,
  mode = "side-by-side",
  width = 600,
  height = 400,
  showStats = true,
  showChangedNodes = true,
  interactive = true,
}: LayoutPreviewProps) {
  const {
    viewMode,
    setViewMode,
    overlaySlider,
    setOverlaySlider,
    zoom,
    changedNodeIds,
    canvasRefBefore,
    canvasRefAfter,
    overlayCanvasRef,
    canvasHandlers,
    zoomControls,
  } = useLayoutPreview({
    beforeWorkflow,
    afterWorkflow,
    initialMode: mode,
    showChangedNodes,
    interactive,
  });

  return (
    <div className="layout-preview">
      <PreviewControls
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        zoom={zoom}
        interactive={interactive}
        zoomControls={zoomControls}
      />

      <PreviewCanvasArea
        viewMode={viewMode}
        width={width}
        height={height}
        overlaySlider={overlaySlider}
        onOverlaySliderChange={setOverlaySlider}
        canvasRefBefore={canvasRefBefore}
        canvasRefAfter={canvasRefAfter}
        overlayCanvasRef={overlayCanvasRef}
        canvasHandlers={canvasHandlers}
      />

      {showStats && (
        <PreviewStats
          changedNodeCount={changedNodeIds.size}
          comparison={comparison}
        />
      )}
    </div>
  );
}
