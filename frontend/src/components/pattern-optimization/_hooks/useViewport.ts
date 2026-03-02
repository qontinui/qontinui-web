import { useState, useRef, useEffect, useCallback } from "react";
import { Point } from "../types";

interface UseViewportOptions {
  controlledZoom?: number;
  controlledPanX?: number;
  controlledPanY?: number;
  onViewportChange?: (viewport: {
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
}

export function useViewport({
  controlledZoom,
  controlledPanX,
  controlledPanY,
  onViewportChange,
}: UseViewportOptions) {
  const isControlled =
    controlledZoom !== undefined && onViewportChange !== undefined;
  const [localZoom, setLocalZoom] = useState(1);
  const [localPan, setLocalPan] = useState<Point>({ x: 0, y: 0 });

  const zoomRef = useRef(isControlled ? controlledZoom : localZoom);
  const panRef = useRef(
    isControlled ? { x: controlledPanX ?? 0, y: controlledPanY ?? 0 } : localPan
  );
  const isControlledRef = useRef(isControlled);
  const onViewportChangeRef = useRef(onViewportChange);

  const zoom = isControlled ? controlledZoom : localZoom;

  const pan: Point = isControlled
    ? { x: controlledPanX ?? 0, y: controlledPanY ?? 0 }
    : localPan;

  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
    isControlledRef.current = isControlled;
    onViewportChangeRef.current = onViewportChange;
  });

  useEffect(() => {
    console.log("[AdvancedRegionSelector] Zoom state changed:", {
      isControlled,
      controlledZoom,
      localZoom,
      effectiveZoom: zoom,
    });
  }, [isControlled, controlledZoom, localZoom, zoom]);

  const setZoom = useCallback(
    (newZoom: number | ((prev: number) => number)) => {
      const currentZoom = zoomRef.current;
      const value =
        typeof newZoom === "function" ? newZoom(currentZoom) : newZoom;
      console.log("[AdvancedRegionSelector] setZoom called:", {
        currentZoom,
        newValue: value,
        isControlled: isControlledRef.current,
      });
      if (isControlledRef.current && onViewportChangeRef.current) {
        onViewportChangeRef.current({ zoom: value });
      } else {
        setLocalZoom(value);
      }
    },
    []
  );

  const setPan = useCallback((newPan: Point | ((prev: Point) => Point)) => {
    const currentPan = panRef.current;
    const value = typeof newPan === "function" ? newPan(currentPan) : newPan;
    if (isControlledRef.current && onViewportChangeRef.current) {
      onViewportChangeRef.current({ panX: value.x, panY: value.y });
    } else {
      setLocalPan(value);
    }
  }, []);

  const resetView = useCallback(() => {
    console.log(
      "[AdvancedRegionSelector] resetView called, isControlled:",
      isControlledRef.current
    );
    if (isControlledRef.current && onViewportChangeRef.current) {
      onViewportChangeRef.current({ zoom: 1, panX: 0, panY: 0 });
    } else {
      setLocalZoom(1);
      setLocalPan({ x: 0, y: 0 });
    }
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const currentZoom = zoomRef.current;
      const newZoom = Math.min(Math.max(0.1, currentZoom * delta), 5);
      console.log("[AdvancedRegionSelector] handleWheel:", {
        currentZoom,
        delta,
        newZoom,
      });
      setZoom(newZoom);
    },
    [setZoom]
  );

  return { zoom, pan, setZoom, setPan, resetView, handleWheel, zoomRef };
}
