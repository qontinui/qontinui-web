"use client";

import { useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import { useImageLoader } from "../_hooks/useImageLoader";
import { useAnnotationCanvas } from "../_hooks/useAnnotationCanvas";
import { useCanvasInteraction } from "../_hooks/useCanvasInteraction";

interface AnnotationCanvasProps {
  className?: string;
}

export function AnnotationCanvas({ className }: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    screenshotUrl,
    setScreenshot,
    selectedElementIds,
    deleteElements,
    undo,
    redo,
  } = useExtractionAnnotationStore();

  const { imageRef, imageLoaded } = useImageLoader(
    screenshotUrl,
    setScreenshot
  );

  const interaction = useCanvasInteraction(canvasRef);

  useAnnotationCanvas(
    canvasRef,
    containerRef,
    imageRef,
    imageLoaded,
    interaction.currentDrawRect
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (selectedElementIds.length > 0) {
            e.preventDefault();
            deleteElements(selectedElementIds);
          }
          break;
        case "z":
          if (isCtrlOrCmd) {
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
          }
          break;
        case "y":
          if (isCtrlOrCmd) {
            e.preventDefault();
            redo();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedElementIds, deleteElements, undo, redo]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-[#1a1a2e] border border-border-subtle rounded-lg ${className}`}
    >
      {!imageLoaded && screenshotUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-canvas/80">
          <Loader2 className="h-6 w-6 animate-spin text-[#9B59B6]" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: interaction.getCursor() }}
        onMouseDown={interaction.handleMouseDown}
        onMouseMove={interaction.handleMouseMove}
        onMouseUp={interaction.handleMouseUp}
        onMouseLeave={interaction.handleMouseLeave}
        onWheel={interaction.handleWheel}
      />
    </div>
  );
}
