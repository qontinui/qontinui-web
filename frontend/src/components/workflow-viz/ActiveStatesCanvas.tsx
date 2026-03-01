/**
 * Active States Canvas - Dual-Mode Rendering
 *
 * Supports two modes:
 *
 * 1. PERCEPTION MODE (default): Shows what the automation "sees" during execution
 *    - Only found images appear on the canvas (at their detected coordinates)
 *    - Active states are shown as a text legend with color coding
 *    - When states are deactivated, their elements disappear from the canvas
 *    - Color coding links state names to their image borders
 *
 * 2. CONFIG MODE: Shows static configuration positions
 *    - Images are shown at their configured positions (offsetX/offsetY or searchRegions)
 *    - Useful for previewing state elements without running automation
 *    - Supports highlightStateId to emphasize a specific state
 *
 * Features:
 * - Zoom constraints that prevent zooming out beyond visible monitors
 * - Grey area outside monitor boundaries
 * - Monitor filter (all monitors vs only monitors with elements)
 */

import React, { useState } from "react";
import { useMonitorCanvas } from "./useMonitorCanvas";
import { MonitorFilter } from "./MonitorFilter";
import { cn } from "@/lib/utils";

import type { ActiveStatesCanvasProps } from "./ActiveStatesCanvas-types";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_MONITORS,
} from "./ActiveStatesCanvas-utils";
import { useMonitorsWithElements } from "./_hooks/useMonitorsWithElements";
import { useActiveStatesData } from "./_hooks/useActiveStatesData";
import { useCanvasRenderer } from "./_hooks/useCanvasRenderer";
import { useLegendPanel } from "./_hooks/useLegendPanel";
import { LegendPanel } from "./_components/LegendPanel";
import { ZoomControls } from "./_components/ZoomControls";
import { EmptyStateOverlay } from "./_components/EmptyStateOverlay";

export type { ActiveStatesCanvasProps } from "./ActiveStatesCanvas-types";

export function ActiveStatesCanvas({
  states,
  images,
  monitors = DEFAULT_MONITORS,
  mode = "perception",
  activeStateIds,
  foundImages,
  connectionState,
  highlightStateId,
  className = "",
  showMonitorFilter = true,
}: ActiveStatesCanvasProps) {
  // Monitor filter state
  const [showOnlyWithElements, setShowOnlyWithElements] = useState(false);

  // Legend panel state (collapse, floating, drag)
  const legend = useLegendPanel();

  // Compute which monitors have elements (needed by useMonitorCanvas)
  const monitorsWithElements = useMonitorsWithElements(
    states,
    mode,
    activeStateIds
  );

  // Use the shared monitor canvas hook
  const canvas = useMonitorCanvas({
    monitors,
    monitorsWithElements,
    showOnlyWithElements,
    maxZoom: 5,
    minFitZoom: 0.4,
    defaultDimensions: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    pinToTop: true,
  });

  // Compute all data derivations (active states, colors, images, bounds, etc.)
  const data = useActiveStatesData({
    states,
    images,
    monitors,
    mode,
    activeStateIds,
    foundImages,
    highlightStateId,
  });

  // Derive monitorOffset from canvas bounds
  const monitorOffset = {
    x: canvas.bounds.offsetX,
    y: canvas.bounds.offsetY,
  };

  // Canvas rendering
  useCanvasRenderer({
    canvasRef: canvas.canvasRef,
    mode,
    visibleFoundImages: data.visibleFoundImages,
    configImages: data.configImages,
    stateBounds: data.stateBounds,
    zoom: canvas.zoom,
    pan: canvas.pan,
    bounds: canvas.bounds,
    containerSize: canvas.containerSize,
    displayedMonitors: canvas.displayedMonitors,
    loadedImages: data.loadedImages,
    monitorOffset,
  });

  const hasFoundImages = data.visibleFoundImages.length > 0;
  const hasConfigImages = data.configImages.length > 0;
  const hasVisibleContent =
    mode === "perception" ? hasFoundImages : hasConfigImages;

  return (
    <div className={cn("relative flex flex-col h-full", className)}>
      {/* Legend - different for each mode */}
      <LegendPanel
        mode={mode}
        activeStatesInfo={data.activeStatesInfo}
        visibleFoundImages={data.visibleFoundImages}
        configImages={data.configImages}
        connectionState={connectionState}
        highlightStateId={highlightStateId}
        isLegendCollapsed={legend.isLegendCollapsed}
        setIsLegendCollapsed={legend.setIsLegendCollapsed}
        isLegendFloating={legend.isLegendFloating}
        setIsLegendFloating={legend.setIsLegendFloating}
        legendPosition={legend.legendPosition}
        handleLegendDragStart={legend.handleLegendDragStart}
      />

      {/* Monitor filter */}
      {showMonitorFilter && monitors.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <MonitorFilter
            showOnlyWithElements={showOnlyWithElements}
            onChange={setShowOnlyWithElements}
            totalMonitors={monitors.length}
            monitorsWithElements={monitorsWithElements.length}
          />
        </div>
      )}

      {/* Zoom Controls */}
      <ZoomControls
        zoom={canvas.zoom}
        onZoomIn={canvas.handleZoomIn}
        onZoomOut={canvas.handleZoomOut}
        onFitView={canvas.handleFitView}
      />

      {/* Canvas */}
      <div
        ref={canvas.containerRef}
        className="flex-1 relative overflow-hidden rounded-lg border"
      >
        <canvas
          ref={canvas.canvasRef}
          style={{ cursor: canvas.isPanning ? "grabbing" : "grab" }}
          onMouseDown={canvas.handleMouseDown}
          onMouseMove={canvas.handleMouseMove}
          onMouseUp={canvas.handleMouseUp}
          onMouseLeave={canvas.handleMouseUp}
          className="w-full h-full"
        />

        {/* Empty state overlay - only for perception mode or config with no images */}
        {!hasVisibleContent && (
          <EmptyStateOverlay
            mode={mode}
            activeStatesInfo={data.activeStatesInfo}
          />
        )}
      </div>

      <div className="mt-2 text-sm text-muted-foreground text-center">
        Drag to pan • Scroll to zoom •{" "}
        {mode === "perception"
          ? "Shows detected images"
          : "Shows configured positions"}
      </div>
    </div>
  );
}
