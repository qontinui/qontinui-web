"use client";

import { useCallback, useState, useMemo } from "react";
import type {
  AnnotatedElement,
  BoundingBox,
} from "@/stores/extraction-annotation-store";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

export function useCanvasInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const [currentDrawRect, setCurrentDrawRect] = useState<BoundingBox | null>(
    null
  );
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(
    null
  );

  const {
    activeTool,
    zoom,
    pan,
    setPan,
    isDrawing,
    drawStart,
    isSelectingBox,
    selectElement,
    setHoveredElement,
    addElement,
    deleteElement,
    setDrawing,
    setZoom,
    getVisibleElements,
    startSelectionBox,
    updateSelectionBox,
    endSelectionBox,
  } = useExtractionAnnotationStore();

  const visibleElements = useMemo(() => {
    return getVisibleElements();
  }, [getVisibleElements]);

  const getElementAtPoint = useCallback(
    (x: number, y: number): AnnotatedElement | null => {
      for (let i = visibleElements.length - 1; i >= 0; i--) {
        const el = visibleElements[i];
        if (!el) continue;
        if (
          x >= el.bbox.x &&
          x <= el.bbox.x + el.bbox.width &&
          y >= el.bbox.y &&
          y <= el.bbox.y + el.bbox.height
        ) {
          return el;
        }
      }
      return null;
    },
    [visibleElements]
  );

  const screenToImage = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (screenX - rect.left - pan.x) / zoom;
      const y = (screenY - rect.top - pan.y) / zoom;
      return { x: Math.round(x), y: Math.round(y) };
    },
    [canvasRef, pan, zoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const shiftKey = e.shiftKey;

      if (activeTool === "select") {
        const element = getElementAtPoint(x, y);
        if (element) {
          selectElement(element.id, shiftKey);
        } else if (!shiftKey) {
          startSelectionBox({ x, y });
        }
      } else if (activeTool === "draw") {
        setDrawing(true, { x, y });
        setCurrentDrawRect({ x, y, width: 0, height: 0 });
      } else if (activeTool === "delete") {
        const element = getElementAtPoint(x, y);
        if (element) {
          deleteElement(element.id);
        }
      } else if (activeTool === "pan") {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [
      activeTool,
      screenToImage,
      getElementAtPoint,
      selectElement,
      setDrawing,
      deleteElement,
      pan,
      startSelectionBox,
    ]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = screenToImage(e.clientX, e.clientY);

      if (isPanning && panStart) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
        return;
      }

      if (activeTool === "select" || activeTool === "delete") {
        const element = getElementAtPoint(x, y);
        setHoveredElement(element?.id || null);
      }

      if (isSelectingBox) {
        updateSelectionBox({ x, y });
        return;
      }

      if (isDrawing && drawStart) {
        const width = x - drawStart.x;
        const height = y - drawStart.y;

        setCurrentDrawRect({
          x: width >= 0 ? drawStart.x : x,
          y: height >= 0 ? drawStart.y : y,
          width: Math.abs(width),
          height: Math.abs(height),
        });
      }
    },
    [
      activeTool,
      isDrawing,
      drawStart,
      isPanning,
      panStart,
      isSelectingBox,
      screenToImage,
      getElementAtPoint,
      setHoveredElement,
      setPan,
      updateSelectionBox,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (isSelectingBox) {
      endSelectionBox();
      return;
    }

    if (isDrawing && currentDrawRect) {
      if (currentDrawRect.width >= 10 && currentDrawRect.height >= 10) {
        addElement({
          bbox: currentDrawRect,
          label: "New Element",
          elementType: "button",
          confidence: 1.0,
          isGroundTruth: true,
          isAutoDetected: false,
        });
      }
    }

    setDrawing(false, null);
    setCurrentDrawRect(null);
  }, [
    isDrawing,
    isPanning,
    isSelectingBox,
    currentDrawRect,
    addElement,
    setDrawing,
    endSelectionBox,
  ]);

  const handleMouseLeave = useCallback(() => {
    setHoveredElement(null);
    if (isDrawing) {
      setDrawing(false, null);
      setCurrentDrawRect(null);
    }
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
    if (isSelectingBox) {
      endSelectionBox();
    }
  }, [
    isDrawing,
    isPanning,
    isSelectingBox,
    setHoveredElement,
    setDrawing,
    endSelectionBox,
  ]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(zoom * delta);
    },
    [zoom, setZoom]
  );

  const getCursor = () => {
    if (isPanning) return "grabbing";
    switch (activeTool) {
      case "select":
        return "default";
      case "draw":
        return "crosshair";
      case "delete":
        return "not-allowed";
      case "pan":
        return "grab";
      default:
        return "default";
    }
  };

  return {
    currentDrawRect,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleWheel,
    getCursor,
  };
}
