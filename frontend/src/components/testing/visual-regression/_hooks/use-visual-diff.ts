import { useState, useRef, useEffect, useCallback } from "react";
import type { ViewMode } from "../types";

export function useVisualDiff(initialMode: ViewMode) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [swipePosition, setSwipePosition] = useState(50);
  const [blinkState, setBlinkState] = useState<"baseline" | "screenshot">(
    "baseline"
  );
  const [zoom, setZoom] = useState(1);
  const [showDiffRegions, setShowDiffRegions] = useState(true);

  const blinkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (mode === "blink") {
      blinkIntervalRef.current = setInterval(() => {
        setBlinkState((prev) =>
          prev === "baseline" ? "screenshot" : "baseline"
        );
      }, 500);
    } else {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
    }

    return () => {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
      }
    };
  }, [mode]);

  const handleZoomIn = useCallback(
    () => setZoom((prev) => Math.min(prev + 0.25, 4)),
    []
  );
  const handleZoomOut = useCallback(
    () => setZoom((prev) => Math.max(prev - 0.25, 0.25)),
    []
  );
  const handleResetZoom = useCallback(() => setZoom(1), []);

  const handleDownload = useCallback(async (url: string, name: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${name}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
    }
  }, []);

  return {
    mode,
    setMode,
    overlayOpacity,
    setOverlayOpacity,
    swipePosition,
    setSwipePosition,
    blinkState,
    zoom,
    showDiffRegions,
    setShowDiffRegions,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleDownload,
  };
}
