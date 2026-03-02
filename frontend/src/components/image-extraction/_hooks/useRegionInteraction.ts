import { useState, useCallback, useEffect } from "react";
import { Region } from "@/types/pattern-optimization";
import type { DragHandle } from "../types";
import {
  getHandleAtPosition,
  getCursorForHandle,
  applyDragToRegion,
} from "../utils";

interface UseRegionInteractionOptions {
  region?: Region;
  onRegionChange: (region: Region) => void;
  zoom: number;
  pan: { x: number; y: number };
  setPan: (pan: { x: number; y: number }) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useRegionInteraction({
  region,
  onRegionChange,
  zoom,
  pan,
  setPan,
  canvasRef,
}: UseRegionInteractionOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<DragHandle>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [currentRegion, setCurrentRegion] = useState<Region | null>(
    region || null
  );

  useEffect(() => {
    if (region) {
      setCurrentRegion(region);
    }
  }, [region]);

  const screenToImage = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };

      const canvasX = screenX - rect.left;
      const canvasY = screenY - rect.top;

      return {
        x: (canvasX - pan.x) / zoom,
        y: (canvasY - pan.y) / zoom,
      };
    },
    [pan, zoom, canvasRef]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const imgPos = screenToImage(e.clientX, e.clientY);

      if (e.button === 2) {
        e.preventDefault();
        setIsPanning(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
      }

      if (e.button === 0) {
        const handle = getHandleAtPosition(
          imgPos.x,
          imgPos.y,
          currentRegion,
          zoom
        );

        if (handle) {
          setIsDragging(true);
          setDragHandle(handle);
          setDragStart(imgPos);
        } else {
          setIsDrawing(true);
          setDragStart(imgPos);
          setCurrentRegion({
            x: imgPos.x,
            y: imgPos.y,
            width: 0,
            height: 0,
          });
        }
      }
    },
    [screenToImage, pan, currentRegion, zoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const imgPos = screenToImage(e.clientX, e.clientY);

      if (isPanning && dragStart) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
        return;
      }

      if (isDrawing && dragStart) {
        const newRegion = {
          x: Math.min(dragStart.x, imgPos.x),
          y: Math.min(dragStart.y, imgPos.y),
          width: Math.abs(imgPos.x - dragStart.x),
          height: Math.abs(imgPos.y - dragStart.y),
        };
        setCurrentRegion(newRegion);
        return;
      }

      if (isDragging && dragStart && currentRegion && dragHandle) {
        const dx = imgPos.x - dragStart.x;
        const dy = imgPos.y - dragStart.y;

        const newRegion = applyDragToRegion(currentRegion, dragHandle, dx, dy);
        setCurrentRegion(newRegion);
        setDragStart(imgPos);
        return;
      }

      // Update cursor based on hover
      const handle = getHandleAtPosition(
        imgPos.x,
        imgPos.y,
        currentRegion,
        zoom
      );
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = getCursorForHandle(handle);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPan is a stable callback; including it would not change behavior
    [
      screenToImage,
      isPanning,
      isDrawing,
      isDragging,
      dragStart,
      dragHandle,
      currentRegion,
      zoom,
      canvasRef,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (isDrawing || isDragging) {
      if (
        currentRegion &&
        currentRegion.width > 0 &&
        currentRegion.height > 0
      ) {
        onRegionChange(currentRegion);
      }
    }

    setIsDrawing(false);
    setIsPanning(false);
    setIsDragging(false);
    setDragHandle(null);
    setDragStart(null);
  }, [isDrawing, isDragging, currentRegion, onRegionChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return {
    currentRegion,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  };
}
