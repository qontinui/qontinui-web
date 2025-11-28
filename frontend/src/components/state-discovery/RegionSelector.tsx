/**
 * Region Selector Component
 * Allows users to draw and adjust a rectangle to select a region for analysis
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CropIcon, Maximize, Move, X } from "lucide-react";

interface RegionSelectorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onRegionSelect: (
    region: { x: number; y: number; width: number; height: number } | null
  ) => void;
  initialRegion?: { x: number; y: number; width: number; height: number };
}

type DragHandle =
  | "none"
  | "move"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

const RegionSelector: React.FC<RegionSelectorProps> = ({
  imageUrl,
  imageWidth,
  imageHeight,
  onRegionSelect,
  initialRegion,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<DragHandle>("none");
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [currentRegion, setCurrentRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(initialRegion || null);
  const [tempRegion, setTempRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [scale, setScale] = useState(1);

  // Calculate scale to fit image in container
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      const scaleX = containerWidth / imageWidth;
      const scaleY = containerHeight / imageHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    }
  }, [imageWidth, imageHeight]);

  // Sync with parent's initialRegion prop
  useEffect(() => {
    if (initialRegion && !isSelecting && !isDragging) {
      setCurrentRegion(initialRegion);
    }
  }, [initialRegion, isSelecting, isDragging]);

  // Get mouse position relative to image
  const getRelativePosition = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };

      const rect = containerRef.current.getBoundingClientRect();

      // Calculate position relative to the centered image
      const containerWidth = rect.width;
      const containerHeight = rect.height;
      const scaledImageWidth = imageWidth * scale;
      const scaledImageHeight = imageHeight * scale;

      // Image is centered, so calculate offset
      const imageLeft = (containerWidth - scaledImageWidth) / 2;
      const imageTop = (containerHeight - scaledImageHeight) / 2;

      // Mouse position relative to container
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Mouse position relative to image
      const x = Math.max(0, Math.min(imageWidth, (mouseX - imageLeft) / scale));
      const y = Math.max(0, Math.min(imageHeight, (mouseY - imageTop) / scale));

      return { x, y };
    },
    [imageWidth, imageHeight, scale]
  );

  // Determine which handle is being hovered/dragged
  const getHandleAtPosition = useCallback(
    (x: number, y: number): DragHandle => {
      if (!currentRegion) return "none";

      const handleSize = 10 / scale;
      const { x: rx, y: ry, width: rw, height: rh } = currentRegion;

      // Check corners first
      if (Math.abs(x - rx) < handleSize && Math.abs(y - ry) < handleSize)
        return "nw";
      if (Math.abs(x - (rx + rw)) < handleSize && Math.abs(y - ry) < handleSize)
        return "ne";
      if (
        Math.abs(x - (rx + rw)) < handleSize &&
        Math.abs(y - (ry + rh)) < handleSize
      )
        return "se";
      if (Math.abs(x - rx) < handleSize && Math.abs(y - (ry + rh)) < handleSize)
        return "sw";

      // Check edges
      if (Math.abs(x - rx) < handleSize && y > ry && y < ry + rh) return "w";
      if (Math.abs(x - (rx + rw)) < handleSize && y > ry && y < ry + rh)
        return "e";
      if (Math.abs(y - ry) < handleSize && x > rx && x < rx + rw) return "n";
      if (Math.abs(y - (ry + rh)) < handleSize && x > rx && x < rx + rw)
        return "s";

      // Check if inside for move
      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return "move";

      return "none";
    },
    [currentRegion, scale]
  );

  // Start selection or drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault(); // Prevent default drag behavior
      e.stopPropagation(); // Stop event from bubbling up
      const pos = getRelativePosition(e);
      const handle = getHandleAtPosition(pos.x, pos.y);

      if (handle !== "none" && currentRegion) {
        // Start dragging existing region
        setIsDragging(true);
        setDragHandle(handle);
        setStartPoint(pos);
      } else if (!currentRegion || handle === "none") {
        // Start new selection
        setIsSelecting(true);
        setStartPoint(pos);
        setCurrentRegion(null);
        // Create a tiny initial region to show selection started
        setTempRegion({ x: pos.x, y: pos.y, width: 1, height: 1 });
      }
    },
    [currentRegion, getRelativePosition, getHandleAtPosition]
  );

  // Update selection or drag
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getRelativePosition(e);

      if (isSelecting) {
        // Create new region
        const x = Math.min(startPoint.x, pos.x);
        const y = Math.min(startPoint.y, pos.y);
        const width = Math.abs(pos.x - startPoint.x);
        const height = Math.abs(pos.y - startPoint.y);

        // Always show temp region for visual feedback
        setTempRegion({ x, y, width, height });

        // Set as current region if large enough
        if (width > 5 && height > 5) {
          setCurrentRegion({ x, y, width, height });
        }
      } else if (isDragging && currentRegion) {
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;

        const newRegion = { ...currentRegion };

        switch (dragHandle) {
          case "move":
            newRegion.x = Math.max(
              0,
              Math.min(imageWidth - newRegion.width, currentRegion.x + dx)
            );
            newRegion.y = Math.max(
              0,
              Math.min(imageHeight - newRegion.height, currentRegion.y + dy)
            );
            break;
          case "nw":
            newRegion.x = Math.min(
              currentRegion.x + currentRegion.width - 10,
              currentRegion.x + dx
            );
            newRegion.y = Math.min(
              currentRegion.y + currentRegion.height - 10,
              currentRegion.y + dy
            );
            newRegion.width = currentRegion.width - dx;
            newRegion.height = currentRegion.height - dy;
            break;
          case "n":
            newRegion.y = Math.min(
              currentRegion.y + currentRegion.height - 10,
              currentRegion.y + dy
            );
            newRegion.height = currentRegion.height - dy;
            break;
          case "ne":
            newRegion.y = Math.min(
              currentRegion.y + currentRegion.height - 10,
              currentRegion.y + dy
            );
            newRegion.width = Math.max(10, currentRegion.width + dx);
            newRegion.height = currentRegion.height - dy;
            break;
          case "e":
            newRegion.width = Math.max(10, currentRegion.width + dx);
            break;
          case "se":
            newRegion.width = Math.max(10, currentRegion.width + dx);
            newRegion.height = Math.max(10, currentRegion.height + dy);
            break;
          case "s":
            newRegion.height = Math.max(10, currentRegion.height + dy);
            break;
          case "sw":
            newRegion.x = Math.min(
              currentRegion.x + currentRegion.width - 10,
              currentRegion.x + dx
            );
            newRegion.width = currentRegion.width - dx;
            newRegion.height = Math.max(10, currentRegion.height + dy);
            break;
          case "w":
            newRegion.x = Math.min(
              currentRegion.x + currentRegion.width - 10,
              currentRegion.x + dx
            );
            newRegion.width = currentRegion.width - dx;
            break;
        }

        setCurrentRegion(newRegion);
        setStartPoint(pos);
      } else {
        // Update cursor based on handle
        const handle = getHandleAtPosition(pos.x, pos.y);
        updateCursor(handle);
      }
    },
    [
      isSelecting,
      isDragging,
      startPoint,
      currentRegion,
      dragHandle,
      getRelativePosition,
      getHandleAtPosition,
      imageWidth,
      imageHeight,
    ]
  );

  // End selection or drag
  const handleMouseUp = useCallback(() => {
    if (isSelecting || isDragging) {
      if (currentRegion) {
        onRegionSelect(currentRegion);
      } else if (tempRegion && tempRegion.width > 5 && tempRegion.height > 5) {
        // Use temp region if no current region but temp is large enough
        setCurrentRegion(tempRegion);
        onRegionSelect(tempRegion);
      }
    }
    setIsSelecting(false);
    setIsDragging(false);
    setDragHandle("none");
    setTempRegion(null);
  }, [isSelecting, isDragging, currentRegion, tempRegion, onRegionSelect]);

  // Update cursor style
  const updateCursor = (handle: DragHandle) => {
    if (!containerRef.current) return;

    const cursors: Record<DragHandle, string> = {
      none: "crosshair",
      move: "move",
      nw: "nw-resize",
      n: "n-resize",
      ne: "ne-resize",
      e: "e-resize",
      se: "se-resize",
      s: "s-resize",
      sw: "sw-resize",
      w: "w-resize",
    };

    containerRef.current.style.cursor = cursors[handle];
  };

  // Clear selection
  const clearSelection = () => {
    setCurrentRegion(null);
    onRegionSelect(null);
  };

  // Select entire image
  const selectAll = () => {
    const region = { x: 0, y: 0, width: imageWidth, height: imageHeight };
    setCurrentRegion(region);
    onRegionSelect(region);
  };

  // Debug info
  const debugInfo = process.env.NODE_ENV === "development" && (
    <div className="text-xs text-gray-500 mb-2">
      isSelecting: {String(isSelecting)}, isDragging: {String(isDragging)},
      startPoint: ({Math.round(startPoint.x)}, {Math.round(startPoint.y)}),
      scale: {scale.toFixed(2)}
    </div>
  );

  return (
    <div className="space-y-4">
      {debugInfo}
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={selectAll}
            disabled={!imageUrl}
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
          <div className="text-sm text-gray-600">
            Region: {Math.round(currentRegion.x)},{Math.round(currentRegion.y)}{" "}
            •{Math.round(currentRegion.width)}×
            {Math.round(currentRegion.height)}px
          </div>
        )}
      </div>

      {/* Image with selection overlay */}
      <Card>
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="relative overflow-hidden bg-gray-100 border-2 border-gray-300"
            style={{
              height: "400px",
              cursor: isSelecting
                ? "crosshair"
                : isDragging
                  ? "move"
                  : "crosshair",
              userSelect: "none",
              minHeight: "400px",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Screenshot"
                style={{
                  width: imageWidth * scale,
                  height: imageHeight * scale,
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Temporary selection rectangle during drawing */}
            {isSelecting && tempRegion && !currentRegion && (
              <div
                className="absolute border-2 border-blue-400 bg-blue-400 bg-opacity-10"
                style={{
                  left: `calc(50% - ${(imageWidth * scale) / 2}px + ${tempRegion.x * scale}px)`,
                  top: `calc(50% - ${(imageHeight * scale) / 2}px + ${tempRegion.y * scale}px)`,
                  width: tempRegion.width * scale,
                  height: tempRegion.height * scale,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Selection rectangle */}
            {currentRegion && (
              <div
                className="absolute border-2 border-blue-500 bg-blue-500 bg-opacity-20"
                style={{
                  left: `calc(50% - ${(imageWidth * scale) / 2}px + ${currentRegion.x * scale}px)`,
                  top: `calc(50% - ${(imageHeight * scale) / 2}px + ${currentRegion.y * scale}px)`,
                  width: currentRegion.width * scale,
                  height: currentRegion.height * scale,
                  pointerEvents: "none",
                }}
              >
                {/* Resize handles */}
                <div
                  className="absolute -left-1 -top-1 w-2 h-2 bg-blue-500 cursor-nw-resize"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute left-1/2 -top-1 w-2 h-2 bg-blue-500 cursor-n-resize -translate-x-1/2"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute -right-1 -top-1 w-2 h-2 bg-blue-500 cursor-ne-resize"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute -right-1 top-1/2 w-2 h-2 bg-blue-500 cursor-e-resize -translate-y-1/2"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute -right-1 -bottom-1 w-2 h-2 bg-blue-500 cursor-se-resize"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute left-1/2 -bottom-1 w-2 h-2 bg-blue-500 cursor-s-resize -translate-x-1/2"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute -left-1 -bottom-1 w-2 h-2 bg-blue-500 cursor-sw-resize"
                  style={{ pointerEvents: "auto" }}
                />
                <div
                  className="absolute -left-1 top-1/2 w-2 h-2 bg-blue-500 cursor-w-resize -translate-y-1/2"
                  style={{ pointerEvents: "auto" }}
                />

                {/* Size label */}
                <div className="absolute -top-6 left-0 text-xs bg-blue-500 text-white px-1 rounded">
                  {Math.round(currentRegion.width)}×
                  {Math.round(currentRegion.height)}
                </div>
              </div>
            )}

            {/* Instructions overlay */}
            {!imageUrl && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <CropIcon className="h-12 w-12 mx-auto mb-2" />
                  <p>Upload screenshots to select analysis region</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="bg-blue-50">
        <CardContent className="py-3">
          <p className="text-sm text-gray-600">
            <strong>Select Analysis Region:</strong> Click and drag to draw a
            rectangle around the area you want to analyze. Drag edges or corners
            to resize. Drag inside to move. This speeds up analysis by focusing
            on specific UI areas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegionSelector;
