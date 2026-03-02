import { useEffect, RefObject } from "react";
import type { BoundingBox } from "../_types/image-canvas";
import { useCanvasRedrawLoop } from "./useCanvasRedrawLoop";

interface UseCanvasRendererOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  imageUrl: string;
  boxes: BoundingBox[];
  selectedBoxId?: string | null;
  tempBox: BoundingBox | null;
  zoom: number;
  pan: { x: number; y: number };
  imageToScreen: (x: number, y: number) => { x: number; y: number };
  readonly: boolean;
}

export function useCanvasRenderer({
  canvasRef,
  containerRef,
  imageRef,
  imageUrl,
  boxes,
  selectedBoxId,
  tempBox,
  zoom,
  pan,
  imageToScreen,
  readonly,
}: UseCanvasRendererOptions) {
  const { redraw } = useCanvasRedrawLoop({
    canvasRef,
    containerRef,
    draw(ctx, canvas) {
      const img = imageRef.current;
      if (!img) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      const allBoxes = tempBox ? [...boxes, tempBox] : boxes;

      allBoxes.forEach((box) => {
        const isSelected = box.id === selectedBoxId;
        const isTemp = box === tempBox;

        const screenPos = imageToScreen(box.x, box.y);
        const screenSize = {
          width: box.width * zoom,
          height: box.height * zoom,
        };

        ctx.strokeStyle = isTemp
          ? "#06b6d4"
          : isSelected
            ? "#eab308"
            : "#22c55e";
        ctx.lineWidth = 2;
        if (isTemp) {
          ctx.setLineDash([5, 5]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(
          screenPos.x,
          screenPos.y,
          screenSize.width,
          screenSize.height
        );

        if (box.label && !isTemp) {
          ctx.fillStyle = isSelected ? "#eab308" : "#22c55e";
          ctx.font = "bold 12px Arial";
          ctx.fillText(box.label, screenPos.x, screenPos.y - 5);
        }

        if (isSelected && !readonly) {
          const handleSize = 6;
          const handles = [
            { x: screenPos.x, y: screenPos.y },
            { x: screenPos.x + screenSize.width / 2, y: screenPos.y },
            { x: screenPos.x + screenSize.width, y: screenPos.y },
            {
              x: screenPos.x + screenSize.width,
              y: screenPos.y + screenSize.height / 2,
            },
            {
              x: screenPos.x + screenSize.width,
              y: screenPos.y + screenSize.height,
            },
            {
              x: screenPos.x + screenSize.width / 2,
              y: screenPos.y + screenSize.height,
            },
            { x: screenPos.x, y: screenPos.y + screenSize.height },
            { x: screenPos.x, y: screenPos.y + screenSize.height / 2 },
          ];

          ctx.fillStyle = "#eab308";
          handles.forEach((handle) => {
            ctx.fillRect(
              handle.x - handleSize / 2,
              handle.y - handleSize / 2,
              handleSize,
              handleSize
            );
          });
        }
      });
    },
    deps: [
      boxes,
      selectedBoxId,
      zoom,
      pan,
      tempBox,
      imageToScreen,
      readonly,
      canvasRef,
      imageRef,
    ],
  });

  // Load the image from URL and trigger a redraw once ready.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      redraw();
    };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);
}
