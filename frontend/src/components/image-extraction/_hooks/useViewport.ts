import { useState, useCallback, useEffect, useRef } from "react";
import type { CompositeBounds } from "../types";

interface UseViewportOptions {
  propZoom?: number;
  propPanX?: number;
  propPanY?: number;
  onViewportChange?: (viewport: {
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
  compositeBounds: CompositeBounds | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  screenshotKey: string;
  hasLoadedImages: boolean;
}

export function useViewport({
  propZoom,
  propPanX,
  propPanY,
  onViewportChange,
  compositeBounds,
  containerRef,
  screenshotKey,
  hasLoadedImages,
}: UseViewportOptions) {
  const isControlled = propZoom !== undefined && onViewportChange !== undefined;
  const [internalZoom, setInternalZoom] = useState(1);
  const [internalPan, setInternalPan] = useState({ x: 0, y: 0 });

  const zoom = isControlled ? propZoom : internalZoom;

  const pan = isControlled
    ? { x: propPanX ?? 0, y: propPanY ?? 0 }
    : internalPan;

  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const setZoom = useCallback(
    (newZoom: number | ((prev: number) => number)) => {
      const currentZoom = zoomRef.current;
      const computedZoom =
        typeof newZoom === "function" ? newZoom(currentZoom) : newZoom;
      zoomRef.current = computedZoom;
      if (isControlled) {
        onViewportChange?.({ zoom: computedZoom });
      } else {
        setInternalZoom(computedZoom);
      }
    },
    [isControlled, onViewportChange]
  );

  const setPan = useCallback(
    (newPan: { x: number; y: number }) => {
      if (isControlled) {
        onViewportChange?.({ panX: newPan.x, panY: newPan.y });
      } else {
        setInternalPan(newPan);
      }
    },
    [isControlled, onViewportChange]
  );

  // Fit view - using ref to avoid dependency issues
  const fitToViewRef = useRef<() => void>(() => {});

  useEffect(() => {
    fitToViewRef.current = () => {
      if (
        !containerRef.current ||
        !compositeBounds ||
        compositeBounds.width === 0
      )
        return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      const padding = 40;
      const availableWidth = containerWidth - padding * 2;
      const availableHeight = containerHeight - padding * 2;

      const scaleX = availableWidth / compositeBounds.width;
      const scaleY = availableHeight / compositeBounds.height;
      const newZoom = Math.min(scaleX, scaleY, 1);

      const centeredX = (containerWidth - compositeBounds.width * newZoom) / 2;
      const centeredY =
        (containerHeight - compositeBounds.height * newZoom) / 2;

      console.log("[CompositeCanvas] fitToView executing:", {
        newZoom,
        centeredX,
        centeredY,
      });
      setZoom(newZoom);
      setPan({ x: centeredX, y: centeredY });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setZoom and setPan are stable callbacks; including them would cause unnecessary re-renders
  }, [compositeBounds]);

  const fitToView = useCallback(() => {
    fitToViewRef.current();
  }, []);

  // Auto fit-to-view on initial load
  const initialFitDoneForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasLoadedImages) return;

    if (initialFitDoneForRef.current === screenshotKey) {
      return;
    }

    initialFitDoneForRef.current = screenshotKey;

    setTimeout(() => {
      const currentZoom = zoomRef.current;
      if (currentZoom === 1) {
        console.log("[CompositeCanvas] Auto fitToView: zoom is default (1)");
        fitToViewRef.current();
      } else {
        console.log(
          "[CompositeCanvas] Skipping auto fitToView: zoom already set to",
          currentZoom
        );
      }
    }, 0);
  }, [hasLoadedImages, screenshotKey]);

  // Wheel zoom handler
  useEffect(() => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;

    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));

      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    canvas.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheelEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setZoom and setPan are stable callbacks; they don't need to be in the dependency array
  }, [zoom, pan]);

  return { zoom, pan, setZoom, setPan, fitToView };
}
