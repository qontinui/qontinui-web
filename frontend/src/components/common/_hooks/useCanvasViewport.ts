import { useState, useCallback, RefObject } from "react";

interface UseCanvasViewportOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  minZoom: number;
  maxZoom: number;
}

export function useCanvasViewport({
  canvasRef,
  minZoom,
  maxZoom,
}: UseCanvasViewportOptions) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const screenToImage = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (screenX - rect.left - pan.x) / zoom;
      const y = (screenY - rect.top - pan.y) / zoom;

      return { x, y };
    },
    [zoom, pan, canvasRef]
  );

  const imageToScreen = useCallback(
    (imageX: number, imageY: number) => {
      return {
        x: imageX * zoom + pan.x,
        y: imageY * zoom + pan.y,
      };
    },
    [zoom, pan]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const delta = e.deltaY > 0 ? 0.833 : 1.2;
      const newZoom = Math.min(Math.max(minZoom, zoom * delta), maxZoom);

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
    [zoom, pan, minZoom, maxZoom, canvasRef]
  );

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(z * 1.2, maxZoom)),
    [maxZoom]
  );

  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(z * 0.833, minZoom)),
    [minZoom]
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return {
    zoom,
    pan,
    setPan,
    screenToImage,
    imageToScreen,
    handleWheel,
    zoomIn,
    zoomOut,
    resetView,
  };
}
