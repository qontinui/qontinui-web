import { useRef, useState, useEffect, useCallback } from "react";

interface UseCanvasZoomOptions {
  zoomMode: "fit" | "original";
  screenshotWidth: number;
  screenshotHeight: number;
}

export function useCanvasZoom({
  zoomMode,
  screenshotWidth,
  screenshotHeight,
}: UseCanvasZoomOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [manualZoom, setManualZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const effectiveZoom = scale * manualZoom;

  const calculateScale = useCallback(() => {
    if (!containerRef.current) {
      setTimeout(() => calculateScale(), 100);
      return;
    }

    if (zoomMode === "original") {
      setScale(1);
      return;
    }

    const containerWidth = containerRef.current.clientWidth - 40;
    const containerHeight = containerRef.current.clientHeight - 40;

    if (containerWidth <= 0 || containerHeight <= 0) {
      setTimeout(() => calculateScale(), 100);
      return;
    }

    const scaleX = containerWidth / screenshotWidth;
    const scaleY = containerHeight / screenshotHeight;
    const newScale = Math.min(scaleX, scaleY, 1);

    setScale(newScale);
  }, [zoomMode, screenshotWidth, screenshotHeight]);

  useEffect(() => {
    const handleResize = () => {
      calculateScale();
    };
    window.addEventListener("resize", handleResize);

    requestAnimationFrame(() => {
      calculateScale();
    });

    return () => window.removeEventListener("resize", handleResize);
  }, [calculateScale]);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [manualZoom]);

  const handleZoomIn = () => {
    setManualZoom((prev) => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setManualZoom((prev) => Math.max(prev / 1.2, 0.1));
  };

  const handleResetZoom = () => {
    setManualZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return {
    containerRef,
    scale,
    manualZoom,
    effectiveZoom,
    offset,
    setOffset,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
  };
}
