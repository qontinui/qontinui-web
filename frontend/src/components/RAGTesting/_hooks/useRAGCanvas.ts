import { useState, useCallback, useEffect, useRef } from "react";
import type { SegmentWithMatches } from "@/types/rag-testing";
import { isPointInBBox } from "../rag-testing-utils";

interface UseRAGCanvasParams {
  segments: SegmentWithMatches[];
  setSelectedSegmentId: (id: string | null) => void;
  setHoveredSegmentId: (id: string | null) => void;
  currentScreenshotUrl: string | null | undefined;
}

export function useRAGCanvas({
  segments,
  setSelectedSegmentId,
  setHoveredSegmentId,
  currentScreenshotUrl,
}: UseRAGCanvasParams) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.2, 5)), []);

  const zoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.2, 0.1)), []);

  // Redraw on window resize
  useEffect(() => {
    const handleResize = () => {
      // Force redraw by updating a dependency - the drawing useEffect will handle it
      if (canvasRef.current && containerRef.current && currentScreenshotUrl) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Trigger redraw by touching zoom state
          setZoom((z) => z);
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentScreenshotUrl]);

  // Get mouse position in image coordinates (accounting for zoom/pan)
  const getImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return null;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();

      // Transform from screen coordinates to image coordinates
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;

      return { x, y };
    },
    [pan, zoom]
  );

  // Handle canvas click (left-click for selection)
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || segments.length === 0) return;

      const coords = getImageCoords(e);
      if (!coords) return;

      // Find clicked segment
      const clickedSegment = segments.find((seg) =>
        isPointInBBox(coords, seg.bbox)
      );

      setSelectedSegmentId(clickedSegment?.id ?? null);
    },
    [segments, getImageCoords, setSelectedSegmentId]
  );

  // Handle canvas hover and panning
  const handleCanvasMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      // Handle panning
      if (isPanning && dragStart) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
        return;
      }

      // Handle hover
      if (segments.length === 0) return;

      const coords = getImageCoords(e);
      if (!coords) return;

      // Find hovered segment
      const hoveredSeg = segments.find((seg) =>
        isPointInBBox(coords, seg.bbox)
      );

      setHoveredSegmentId(hoveredSeg?.id ?? null);
    },
    [segments, isPanning, dragStart, getImageCoords, setHoveredSegmentId]
  );

  // Handle mouse down (right-click for panning)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Right-click for panning
      if (e.button === 2) {
        e.preventDefault();
        setIsPanning(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [pan]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDragStart(null);
  }, []);

  // Handle mouse wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(0.1, zoom * delta), 5);
      setZoom(newZoom);
    },
    [zoom]
  );

  return {
    zoom,
    setZoom,
    pan,
    canvasRef,
    containerRef,
    resetView,
    zoomIn,
    zoomOut,
    handleCanvasClick,
    handleCanvasMove,
    handleMouseDown,
    handleMouseUp,
    handleWheel,
  };
}
