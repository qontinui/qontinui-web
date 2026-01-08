/**
 * Region Selector Component for Direct Pattern Creation
 * Allows drawing regions on screenshots and displays existing extracted regions
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Maximize, X } from "lucide-react";
import type { Region } from "@/types/direct-pattern-creation";

interface DirectPatternRegionSelectorProps {
  imageUrl: string;
  onRegionSelected: (region: Region | null) => void;
  existingRegions?: Region[];
  currentRegion?: Region | null;
}

export function DirectPatternRegionSelector({
  imageUrl,
  onRegionSelected,
  existingRegions = [],
  currentRegion = null,
}: DirectPatternRegionSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [tempRegion, setTempRegion] = useState<Region | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [scale, setScale] = useState(1);

  // Load image and get dimensions
  useEffect(() => {
    if (!imageUrl) return;

    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height });

      // Calculate scale to fit in container
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        const scaleX = containerWidth / img.width;
        const scaleY = containerHeight / img.height;
        setScale(Math.min(scaleX, scaleY, 1));
      }
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Get mouse position relative to image
  const getRelativePosition = useCallback(
    (e: React.MouseEvent): { x: number; y: number } | null => {
      if (!containerRef.current || !imageDimensions) return null;

      const rect = containerRef.current.getBoundingClientRect();
      const scaledWidth = imageDimensions.width * scale;
      const scaledHeight = imageDimensions.height * scale;

      // Image is centered
      const imageLeft = (rect.width - scaledWidth) / 2;
      const imageTop = (rect.height - scaledHeight) / 2;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Check if mouse is within image bounds
      if (
        mouseX < imageLeft ||
        mouseX > imageLeft + scaledWidth ||
        mouseY < imageTop ||
        mouseY > imageTop + scaledHeight
      ) {
        return null;
      }

      // Convert to image coordinates
      const x = Math.max(
        0,
        Math.min(imageDimensions.width, (mouseX - imageLeft) / scale)
      );
      const y = Math.max(
        0,
        Math.min(imageDimensions.height, (mouseY - imageTop) / scale)
      );

      return { x, y };
    },
    [imageDimensions, scale]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = getRelativePosition(e);
      if (!pos) return;

      setIsDrawing(true);
      setStartPoint(pos);
      setTempRegion({ x: pos.x, y: pos.y, width: 1, height: 1 });
    },
    [getRelativePosition]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing || !startPoint) return;

      const pos = getRelativePosition(e);
      if (!pos) return;

      const region: Region = {
        x: Math.min(startPoint.x, pos.x),
        y: Math.min(startPoint.y, pos.y),
        width: Math.abs(pos.x - startPoint.x),
        height: Math.abs(pos.y - startPoint.y),
      };

      setTempRegion(region);
    },
    [isDrawing, startPoint, getRelativePosition]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !tempRegion) {
      setIsDrawing(false);
      return;
    }

    // Only accept regions larger than 10x10
    if (tempRegion.width > 10 && tempRegion.height > 10) {
      onRegionSelected(tempRegion);
    }

    setIsDrawing(false);
    setStartPoint(null);
    setTempRegion(null);
  }, [isDrawing, tempRegion, onRegionSelected]);

  const clearSelection = () => {
    onRegionSelected(null);
    setTempRegion(null);
  };

  const selectAll = () => {
    if (!imageDimensions) return;
    onRegionSelected({
      x: 0,
      y: 0,
      width: imageDimensions.width,
      height: imageDimensions.height,
    });
  };

  // Render region rectangle
  const renderRegion = (region: Region, color: string, label?: string) => {
    if (!imageDimensions) return null;

    const scaledRegion = {
      x: region.x * scale,
      y: region.y * scale,
      width: region.width * scale,
      height: region.height * scale,
    };

    const containerWidth = containerRef.current?.clientWidth || 0;
    const containerHeight = containerRef.current?.clientHeight || 0;
    const scaledImageWidth = imageDimensions.width * scale;
    const scaledImageHeight = imageDimensions.height * scale;

    const imageLeft = (containerWidth - scaledImageWidth) / 2;
    const imageTop = (containerHeight - scaledImageHeight) / 2;

    return (
      <div
        key={`${region.x}-${region.y}`}
        className="absolute border-2 pointer-events-none"
        style={{
          left: imageLeft + scaledRegion.x,
          top: imageTop + scaledRegion.y,
          width: scaledRegion.width,
          height: scaledRegion.height,
          borderColor: color,
          backgroundColor: `${color}20`,
        }}
      >
        {label && (
          <div
            className="absolute -top-6 left-0 text-xs px-1 rounded text-white"
            style={{ backgroundColor: color }}
          >
            {label}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={selectAll}
            disabled={!imageDimensions}
          >
            <Maximize className="mr-2 h-4 w-4" />
            Select All
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearSelection}
            disabled={!currentRegion}
          >
            <X className="mr-2 h-4 w-4" />
            Clear
          </Button>
        </div>
        {currentRegion && (
          <div className="text-sm text-text-muted">
            {Math.round(currentRegion.width)} ×{" "}
            {Math.round(currentRegion.height)}px
          </div>
        )}
      </div>

      {/* Image with overlay */}
      <div
        ref={containerRef}
        className="relative bg-surface-raised border-2 border-border-default overflow-hidden cursor-crosshair"
        style={{ height: "500px", userSelect: "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {imageDimensions && (
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Screenshot"
            className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              width: imageDimensions.width * scale,
              height: imageDimensions.height * scale,
            }}
          />
        )}

        {/* Existing regions (gray) */}
        {existingRegions.map((region, idx) =>
          renderRegion(region, "#9CA3AF", `#${idx + 1}`)
        )}

        {/* Current/selected region (blue) */}
        {currentRegion &&
          !isDrawing &&
          renderRegion(currentRegion, "#3B82F6", "Selected")}

        {/* Temporary drawing region (blue dashed) */}
        {isDrawing &&
          tempRegion &&
          renderRegion(tempRegion, "#60A5FA", "Drawing")}

        {!imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted">
            <p>No screenshot selected</p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="text-xs text-text-muted bg-blue-50 p-2 rounded">
        <strong>Instructions:</strong> Click and drag to select a region.
        Previously extracted regions are shown in gray. The current selection is
        shown in blue.
      </div>
    </div>
  );
}
