/**
 * Hook for RegionSelector mouse interaction logic
 * Handles drawing new regions, dragging, and resizing via handles
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Region, DragHandle, CURSOR_MAP } from "../region-selector-types";

interface UseRegionSelectorInteractionArgs {
  imageWidth: number;
  imageHeight: number;
  initialRegion?: Region;
  onRegionSelect: (region: Region | null | undefined) => void;
}

export function useRegionSelectorInteraction({
  imageWidth,
  imageHeight,
  initialRegion,
  onRegionSelect,
}: UseRegionSelectorInteractionArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<DragHandle>("none");
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [currentRegion, setCurrentRegion] = useState<Region | null>(
    initialRegion || null
  );
  const [tempRegion, setTempRegion] = useState<Region | null>(null);
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

  // Update cursor style
  const updateCursor = (handle: DragHandle) => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = CURSOR_MAP[handle];
  };

  // Apply drag/resize delta to region based on active handle
  const applyDragDelta = useCallback(
    (region: Region, dx: number, dy: number, handle: DragHandle): Region => {
      const newRegion = { ...region };

      switch (handle) {
        case "move":
          newRegion.x = Math.max(
            0,
            Math.min(imageWidth - newRegion.width, region.x + dx)
          );
          newRegion.y = Math.max(
            0,
            Math.min(imageHeight - newRegion.height, region.y + dy)
          );
          break;
        case "nw":
          newRegion.x = Math.min(region.x + region.width - 10, region.x + dx);
          newRegion.y = Math.min(region.y + region.height - 10, region.y + dy);
          newRegion.width = region.width - dx;
          newRegion.height = region.height - dy;
          break;
        case "n":
          newRegion.y = Math.min(region.y + region.height - 10, region.y + dy);
          newRegion.height = region.height - dy;
          break;
        case "ne":
          newRegion.y = Math.min(region.y + region.height - 10, region.y + dy);
          newRegion.width = Math.max(10, region.width + dx);
          newRegion.height = region.height - dy;
          break;
        case "e":
          newRegion.width = Math.max(10, region.width + dx);
          break;
        case "se":
          newRegion.width = Math.max(10, region.width + dx);
          newRegion.height = Math.max(10, region.height + dy);
          break;
        case "s":
          newRegion.height = Math.max(10, region.height + dy);
          break;
        case "sw":
          newRegion.x = Math.min(region.x + region.width - 10, region.x + dx);
          newRegion.width = region.width - dx;
          newRegion.height = Math.max(10, region.height + dy);
          break;
        case "w":
          newRegion.x = Math.min(region.x + region.width - 10, region.x + dx);
          newRegion.width = region.width - dx;
          break;
      }

      return newRegion;
    },
    [imageWidth, imageHeight]
  );

  // Start selection or drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
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
        const x = Math.min(startPoint.x, pos.x);
        const y = Math.min(startPoint.y, pos.y);
        const width = Math.abs(pos.x - startPoint.x);
        const height = Math.abs(pos.y - startPoint.y);

        setTempRegion({ x, y, width, height });

        if (width > 5 && height > 5) {
          setCurrentRegion({ x, y, width, height });
        }
      } else if (isDragging && currentRegion) {
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;
        setCurrentRegion(applyDragDelta(currentRegion, dx, dy, dragHandle));
        setStartPoint(pos);
      } else {
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
      applyDragDelta,
    ]
  );

  // End selection or drag
  const handleMouseUp = useCallback(() => {
    if (isSelecting || isDragging) {
      if (currentRegion) {
        onRegionSelect(currentRegion);
      } else if (tempRegion && tempRegion.width > 5 && tempRegion.height > 5) {
        setCurrentRegion(tempRegion);
        onRegionSelect(tempRegion);
      }
    }
    setIsSelecting(false);
    setIsDragging(false);
    setDragHandle("none");
    setTempRegion(null);
  }, [isSelecting, isDragging, currentRegion, tempRegion, onRegionSelect]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setCurrentRegion(null);
    onRegionSelect(null);
  }, [onRegionSelect]);

  // Select entire image
  const selectAll = useCallback(() => {
    const region = { x: 0, y: 0, width: imageWidth, height: imageHeight };
    setCurrentRegion(region);
    onRegionSelect(region);
  }, [imageWidth, imageHeight, onRegionSelect]);

  return {
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
  };
}
