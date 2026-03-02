/**
 * Region Selector Component
 * Allows users to draw and adjust a rectangle to select a region for analysis.
 *
 * Thin orchestrator that composes:
 *  - useRegionSelectorInteraction (all state + mouse interaction logic)
 *  - RegionSelectorControls (toolbar: Select All / Clear / region info)
 *  - RegionSelectorCanvas (image + selection overlays + resize handles)
 *  - RegionSelectorInstructions (help text card)
 */

import React from "react";
import { useRegionSelectorInteraction } from "./_hooks/useRegionSelectorInteraction";
import RegionSelectorControls from "./_components/RegionSelectorControls";
import RegionSelectorCanvas from "./_components/RegionSelectorCanvas";
import RegionSelectorInstructions from "./_components/RegionSelectorInstructions";
import { RegionSelectorProps } from "./region-selector-types";

const RegionSelector: React.FC<RegionSelectorProps> = ({
  imageUrl,
  imageWidth,
  imageHeight,
  onRegionSelect,
  initialRegion,
}) => {
  const {
    containerRef,
    isSelecting,
    isDragging,
    startPoint,
    currentRegion,
    tempRegion,
    scale,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    clearSelection,
    selectAll,
  } = useRegionSelectorInteraction({
    imageWidth,
    imageHeight,
    initialRegion,
    onRegionSelect,
  });

  const debugInfo = process.env.NODE_ENV === "development" && (
    <div className="text-xs text-text-muted mb-2">
      isSelecting: {String(isSelecting)}, isDragging: {String(isDragging)},
      startPoint: ({Math.round(startPoint.x)}, {Math.round(startPoint.y)}),
      scale: {scale.toFixed(2)}
    </div>
  );

  return (
    <div className="space-y-4">
      {debugInfo}

      <RegionSelectorControls
        imageUrl={imageUrl}
        currentRegion={currentRegion}
        onSelectAll={selectAll}
        onClear={clearSelection}
      />

      <RegionSelectorCanvas
        containerRef={containerRef}
        imageUrl={imageUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        scale={scale}
        isSelecting={isSelecting}
        isDragging={isDragging}
        currentRegion={currentRegion}
        tempRegion={tempRegion}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />

      <RegionSelectorInstructions />
    </div>
  );
};

export default RegionSelector;
