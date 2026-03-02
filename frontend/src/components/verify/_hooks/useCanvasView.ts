import { useState, useCallback, useEffect, type RefObject } from "react";

interface CanvasSize {
  width: number;
  height: number;
}

interface ViewState {
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
}

function computeFitZoom(
  containerWidth: number,
  containerHeight: number,
  canvasSize: CanvasSize
) {
  const zoomX = (containerWidth - 80) / canvasSize.width;
  const zoomY = (containerHeight - 80) / canvasSize.height;
  return Math.min(zoomX, zoomY, 1);
}

function computeCenteredPan(
  containerWidth: number,
  containerHeight: number,
  canvasSize: CanvasSize,
  fitZoom: number
) {
  return {
    x: (containerWidth - canvasSize.width * fitZoom) / 2,
    y: (containerHeight - canvasSize.height * fitZoom) / 2,
  };
}

/**
 * Manages pan/zoom state and mouse interaction for the canvas.
 * Returns view state, mouse event handlers, and zoom control callbacks.
 */
export function useCanvasView(
  canvasSize: CanvasSize,
  containerRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>
) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );

  // Auto-fit on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const fitZoom = computeFitZoom(containerWidth, containerHeight, canvasSize);

    setZoom(fitZoom);
    setPan(
      computeCenteredPan(containerWidth, containerHeight, canvasSize, fitZoom)
    );
  }, [canvasSize.width, canvasSize.height, containerRef]);

  // Mouse handlers for pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning && dragStart) {
        setPan((prev) => ({
          x: prev.x + (e.clientX - dragStart.x),
          y: prev.y + (e.clientY - dragStart.y),
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    },
    [isPanning, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDragStart(null);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(0.1, zoom * delta), 5);

      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        setPan({
          x: mouseX - ((mouseX - pan.x) * newZoom) / zoom,
          y: mouseY - ((mouseY - pan.y) * newZoom) / zoom,
        });
      }

      setZoom(newZoom);
    },
    [zoom, pan, canvasRef]
  );

  // Zoom controls
  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(z * 1.2, 5)),
    []
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(z * 0.833, 0.1)),
    []
  );
  const handleResetView = useCallback(() => {
    const containerWidth = containerRef.current?.clientWidth || 800;
    const containerHeight = containerRef.current?.clientHeight || 600;
    const fitZoom = computeFitZoom(containerWidth, containerHeight, canvasSize);

    setZoom(fitZoom);
    setPan(
      computeCenteredPan(containerWidth, containerHeight, canvasSize, fitZoom)
    );
  }, [canvasSize, containerRef]);

  const viewState: ViewState = { zoom, pan, isPanning };

  const mouseHandlers = {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
  };

  const zoomControls = {
    handleZoomIn,
    handleZoomOut,
    handleResetView,
  };

  return { viewState, mouseHandlers, zoomControls };
}
