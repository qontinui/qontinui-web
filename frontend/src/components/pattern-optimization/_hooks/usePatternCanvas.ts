import { useState, useEffect, useRef } from "react";
import type { ExtractedPattern } from "@/types/pattern-optimization";

const BRUSH_RADIUS = 5;

interface UsePatternCanvasOptions {
  editMode: "none" | "add" | "remove";
  extractedPattern: ExtractedPattern | null;
  editedPattern: string | null;
  onEditedPatternChange: (dataUrl: string) => void;
}

/**
 * Manages the editable canvas for pattern transparency editing.
 * Handles mouse events, brush painting, checkerboard rendering, and cursor tracking.
 */
export function usePatternCanvas({
  editMode,
  extractedPattern,
  editedPattern,
  onEditedPatternChange,
}: UsePatternCanvasOptions) {
  const patternCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );

  // Initialize pattern canvas when entering edit mode
  useEffect(() => {
    if (
      editMode !== "none" &&
      extractedPattern?.patternImage &&
      patternCanvasRef.current
    ) {
      const canvas = patternCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw checkerboard background for transparency
      const checkSize = 5;
      for (let y = 0; y < canvas.height; y += checkSize) {
        for (let x = 0; x < canvas.width; x += checkSize) {
          ctx.fillStyle =
            (x / checkSize + y / checkSize) % 2 === 0 ? "#f3f4f6" : "#ffffff";
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }

      // Draw the pattern image
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = editedPattern || extractedPattern.patternImage;
    }
  }, [editMode, extractedPattern, editedPattern]);

  const handlePatternEdit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (editMode === "none" || !patternCanvasRef.current || !extractedPattern)
      return;

    const canvas = patternCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(
      (event.clientX - rect.left) * (canvas.width / rect.width)
    );
    const y = Math.floor(
      (event.clientY - rect.top) * (canvas.height / rect.height)
    );

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get the current image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Create a circular brush
    for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
      for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
        if (dx * dx + dy * dy <= BRUSH_RADIUS * BRUSH_RADIUS) {
          const px = x + dx;
          const py = y + dy;

          if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height) {
            const index = (py * canvas.width + px) * 4;

            if (editMode === "add") {
              // Add transparency (make pixels transparent)
              imageData.data[index + 3] = 0; // Set alpha to 0
            } else if (editMode === "remove") {
              // Remove transparency (make pixels opaque)
              if (imageData.data[index + 3] === 0) {
                // Only fill if currently transparent
                imageData.data[index] = 128; // R
                imageData.data[index + 1] = 128; // G
                imageData.data[index + 2] = 128; // B
                imageData.data[index + 3] = 255; // A
              }
            }
          }
        }
      }
    }

    // Put the modified image data back
    ctx.putImageData(imageData, 0, 0);

    // Save the edited pattern
    onEditedPatternChange(canvas.toDataURL());
  };

  const handlePatternMouseMove = (
    event: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if (!patternCanvasRef.current) return;

    const canvas = patternCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    setCursorPos({ x, y });

    // Handle dragging
    if (event.buttons === 1 && editMode !== "none") {
      handlePatternEdit(event);
    }
  };

  const handlePatternMouseLeave = () => {
    setCursorPos(null);
  };

  return {
    patternCanvasRef,
    cursorPos,
    brushRadius: BRUSH_RADIUS,
    handlePatternEdit,
    handlePatternMouseMove,
    handlePatternMouseLeave,
  };
}
