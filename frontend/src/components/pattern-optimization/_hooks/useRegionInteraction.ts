import { useState, useEffect, useCallback } from "react";
import { Region } from "@/types/pattern-optimization";
import { DragHandle, Point } from "../types";

interface UseRegionInteractionOptions {
  region?: Region;
  zoom: number;
  pan: Point;
  setPan: (pan: Point | ((prev: Point) => Point)) => void;
  onRegionChange: (region: Region) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useRegionInteraction({
  region,
  zoom,
  pan,
  setPan,
  onRegionChange,
  canvasRef,
}: UseRegionInteractionOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<DragHandle>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(
    region || null
  );

  useEffect(() => {
    if (region) {
      setCurrentRegion(region);
    }
  }, [region]);

  const getImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point | null => {
      if (!canvasRef.current) return null;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();

      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;

      return { x, y };
    },
    [canvasRef, pan, zoom]
  );

  const getHandleAtPoint = useCallback(
    (x: number, y: number): DragHandle => {
      if (!currentRegion) return null;

      const handleSize = 8 / zoom;
      const threshold = handleSize * 1.5;

      if (
        Math.abs(x - currentRegion.x) < threshold &&
        Math.abs(y - currentRegion.y) < threshold
      )
        return "tl";
      if (
        Math.abs(x - (currentRegion.x + currentRegion.width)) < threshold &&
        Math.abs(y - currentRegion.y) < threshold
      )
        return "tr";
      if (
        Math.abs(x - currentRegion.x) < threshold &&
        Math.abs(y - (currentRegion.y + currentRegion.height)) < threshold
      )
        return "bl";
      if (
        Math.abs(x - (currentRegion.x + currentRegion.width)) < threshold &&
        Math.abs(y - (currentRegion.y + currentRegion.height)) < threshold
      )
        return "br";

      if (
        Math.abs(x - (currentRegion.x + currentRegion.width / 2)) < threshold &&
        Math.abs(y - currentRegion.y) < threshold
      )
        return "t";
      if (
        Math.abs(x - (currentRegion.x + currentRegion.width)) < threshold &&
        Math.abs(y - (currentRegion.y + currentRegion.height / 2)) < threshold
      )
        return "r";
      if (
        Math.abs(x - (currentRegion.x + currentRegion.width / 2)) < threshold &&
        Math.abs(y - (currentRegion.y + currentRegion.height)) < threshold
      )
        return "b";
      if (
        Math.abs(x - currentRegion.x) < threshold &&
        Math.abs(y - (currentRegion.y + currentRegion.height / 2)) < threshold
      )
        return "l";

      if (
        x >= currentRegion.x &&
        x <= currentRegion.x + currentRegion.width &&
        y >= currentRegion.y &&
        y <= currentRegion.y + currentRegion.height
      ) {
        return "move";
      }

      return null;
    },
    [currentRegion, zoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      console.log("[AdvancedRegionSelector] Mouse down");
      const coords = getImageCoords(e);
      if (!coords) {
        console.log("[AdvancedRegionSelector] Could not get image coords");
        return;
      }
      console.log("[AdvancedRegionSelector] Coords:", coords);

      if (e.button === 2) {
        e.preventDefault();
        setIsPanning(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
      }

      if (e.button === 0) {
        const handle = getHandleAtPoint(coords.x, coords.y);
        if (handle) {
          console.log("[AdvancedRegionSelector] Clicking on handle:", handle);
          setIsDragging(true);
          setDragHandle(handle);
          setDragStart(coords);
        } else {
          console.log("[AdvancedRegionSelector] Starting new region");
          setIsDrawing(true);
          setDragStart(coords);
          setCurrentRegion(null);
        }
      }
    },
    [getImageCoords, getHandleAtPoint, pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getImageCoords(e);

      if (!isDrawing && !isDragging && !isPanning && coords) {
        const handle = getHandleAtPoint(coords.x, coords.y);
        if (handle === "move") {
          e.currentTarget.style.cursor = "move";
        } else if (handle === "tl" || handle === "br") {
          e.currentTarget.style.cursor = "nwse-resize";
        } else if (handle === "tr" || handle === "bl") {
          e.currentTarget.style.cursor = "nesw-resize";
        } else if (handle === "t" || handle === "b") {
          e.currentTarget.style.cursor = "ns-resize";
        } else if (handle === "l" || handle === "r") {
          e.currentTarget.style.cursor = "ew-resize";
        } else {
          e.currentTarget.style.cursor = "crosshair";
        }
      }

      if (isPanning && dragStart) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      } else if (isDrawing && dragStart && coords) {
        const newRegion: Region = {
          x: Math.min(dragStart.x, coords.x),
          y: Math.min(dragStart.y, coords.y),
          width: Math.abs(coords.x - dragStart.x),
          height: Math.abs(coords.y - dragStart.y),
        };
        setCurrentRegion(newRegion);
      } else if (
        isDragging &&
        dragHandle &&
        currentRegion &&
        dragStart &&
        coords
      ) {
        const newRegion = { ...currentRegion };

        switch (dragHandle) {
          case "move":
            const dx = coords.x - dragStart.x;
            const dy = coords.y - dragStart.y;
            newRegion.x = currentRegion.x + dx;
            newRegion.y = currentRegion.y + dy;
            setDragStart(coords);
            break;
          case "tl":
            newRegion.x = coords.x;
            newRegion.y = coords.y;
            newRegion.width = currentRegion.x + currentRegion.width - coords.x;
            newRegion.height =
              currentRegion.y + currentRegion.height - coords.y;
            break;
          case "tr":
            newRegion.y = coords.y;
            newRegion.width = coords.x - currentRegion.x;
            newRegion.height =
              currentRegion.y + currentRegion.height - coords.y;
            break;
          case "bl":
            newRegion.x = coords.x;
            newRegion.width = currentRegion.x + currentRegion.width - coords.x;
            newRegion.height = coords.y - currentRegion.y;
            break;
          case "br":
            newRegion.width = coords.x - currentRegion.x;
            newRegion.height = coords.y - currentRegion.y;
            break;
          case "t":
            newRegion.y = coords.y;
            newRegion.height =
              currentRegion.y + currentRegion.height - coords.y;
            break;
          case "r":
            newRegion.width = coords.x - currentRegion.x;
            break;
          case "b":
            newRegion.height = coords.y - currentRegion.y;
            break;
          case "l":
            newRegion.x = coords.x;
            newRegion.width = currentRegion.x + currentRegion.width - coords.x;
            break;
        }

        if (newRegion.width > 10 && newRegion.height > 10) {
          setCurrentRegion(newRegion);
        }
      }
    },
    [
      getImageCoords,
      getHandleAtPoint,
      isDrawing,
      isDragging,
      isPanning,
      dragStart,
      dragHandle,
      currentRegion,
      setPan,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (currentRegion && (isDrawing || isDragging)) {
      if (currentRegion.width > 10 && currentRegion.height > 10) {
        onRegionChange(currentRegion);
        console.log("[AdvancedRegionSelector] Region saved:", currentRegion);
      }
    }

    setIsDrawing(false);
    setIsPanning(false);
    setIsDragging(false);
    setDragHandle(null);
    setDragStart(null);
  }, [currentRegion, isDrawing, isDragging, onRegionChange]);

  return {
    currentRegion,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
