import React, { useRef, useState, useCallback } from "react";
import {
  Screenshot,
  ScreenshotRegion,
  ScreenshotLocation,
  SelectionMode,
} from "../../../types/Screenshot";
import { generateId } from "../../../lib/utils";

interface UseCanvasInteractionOptions {
  screenshot: Screenshot;
  selectionMode: SelectionMode;
  effectiveZoom: number;
  offset: { x: number; y: number };
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  onRegionCreate: (region: ScreenshotRegion) => void;
  onLocationCreate: (location: ScreenshotLocation) => void;
  onRegionSelect: (region: ScreenshotRegion | null) => void;
  onLocationSelect: (location: ScreenshotLocation | null) => void;
}

export function useCanvasInteraction({
  screenshot,
  selectionMode,
  effectiveZoom,
  offset,
  setOffset,
  onRegionCreate,
  onLocationCreate,
  onRegionSelect,
  onLocationSelect,
}: UseCanvasInteractionOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [currentRect, setCurrentRect] = useState<DOMRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredRegion, setHoveredRegion] = useState<ScreenshotRegion | null>(
    null
  );
  const [hoveredLocation, setHoveredLocation] =
    useState<ScreenshotLocation | null>(null);

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / effectiveZoom,
        y: (e.clientY - rect.top) / effectiveZoom,
      };
    },
    [effectiveZoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 2) {
        e.preventDefault();
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
        return;
      }

      if (e.button === 0) {
        const coords = getCanvasCoordinates(e);

        if (selectionMode === "view") {
          const clickedRegion = screenshot.regions.find(
            (r) =>
              coords.x >= r.bounds.x &&
              coords.x <= r.bounds.x + r.bounds.width &&
              coords.y >= r.bounds.y &&
              coords.y <= r.bounds.y + r.bounds.height
          );

          if (clickedRegion) {
            onRegionSelect(clickedRegion);
            onLocationSelect(null);
            return;
          }

          const clickedLocation = screenshot.locations.find((l) => {
            const distance = Math.sqrt(
              Math.pow(coords.x - l.x, 2) + Math.pow(coords.y - l.y, 2)
            );
            return distance < 10;
          });

          if (clickedLocation) {
            onLocationSelect(clickedLocation);
            onRegionSelect(null);
            return;
          }

          onRegionSelect(null);
          onLocationSelect(null);
          return;
        }

        if (selectionMode === "location") {
          onLocationCreate({
            id: generateId(),
            screenshotId: screenshot.id,
            stateId: screenshot.associatedStates[0] || "",
            name: `Location_${screenshot.locations.length + 1}`,
            x: Math.round(coords.x),
            y: Math.round(coords.y),
          });
        } else if (selectionMode === "region") {
          setIsDrawing(true);
          setStartPoint(coords);
        }
      }
    },
    [
      getCanvasCoordinates,
      selectionMode,
      screenshot,
      offset,
      onRegionSelect,
      onLocationSelect,
      onLocationCreate,
    ]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isDragging) {
        setOffset({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
        return;
      }

      const coords = getCanvasCoordinates(e);

      if (selectionMode === "view") {
        const hoverRegion = screenshot.regions.find(
          (r) =>
            coords.x >= r.bounds.x &&
            coords.x <= r.bounds.x + r.bounds.width &&
            coords.y >= r.bounds.y &&
            coords.y <= r.bounds.y + r.bounds.height
        );
        setHoveredRegion(hoverRegion || null);

        const hoverLocation = screenshot.locations.find((l) => {
          const distance = Math.sqrt(
            Math.pow(coords.x - l.x, 2) + Math.pow(coords.y - l.y, 2)
          );
          return distance < 10;
        });
        setHoveredLocation(hoverLocation || null);
      }

      if (!isDrawing || !startPoint) return;

      const newRect = new DOMRect(
        Math.min(startPoint.x, coords.x),
        Math.min(startPoint.y, coords.y),
        Math.abs(coords.x - startPoint.x),
        Math.abs(coords.y - startPoint.y)
      );

      setCurrentRect(newRect);
    },
    [
      isDragging,
      dragStart,
      getCanvasCoordinates,
      selectionMode,
      screenshot,
      isDrawing,
      startPoint,
      setOffset,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      return;
    }

    if (!isDrawing || !currentRect || !startPoint) return;

    if (currentRect.width > 5 && currentRect.height > 5) {
      onRegionCreate({
        id: generateId(),
        screenshotId: screenshot.id,
        stateId: screenshot.associatedStates[0] || "",
        name: `Region_${screenshot.regions.length + 1}`,
        type: "StateRegion",
        bounds: {
          x: Math.round(currentRect.x),
          y: Math.round(currentRect.y),
          width: Math.round(currentRect.width),
          height: Math.round(currentRect.height),
        },
      });
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
  }, [
    isDragging,
    isDrawing,
    currentRect,
    startPoint,
    screenshot,
    onRegionCreate,
  ]);

  const handleMouseLeave = useCallback(() => {
    handleMouseUp();
    setHoveredRegion(null);
    setHoveredLocation(null);
    setIsDragging(false);
  }, [handleMouseUp]);

  const getCursor = useCallback(() => {
    if (isDragging) return "grabbing";
    if (selectionMode === "view") {
      if (hoveredRegion || hoveredLocation) return "pointer";
      return "default";
    }
    if (selectionMode === "location") return "crosshair";
    if (selectionMode === "region") return "crosshair";
    return "default";
  }, [isDragging, selectionMode, hoveredRegion, hoveredLocation]);

  return {
    canvasRef,
    isDrawing,
    startPoint,
    currentRect,
    hoveredRegion,
    hoveredLocation,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    getCursor,
  };
}
