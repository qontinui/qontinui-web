"use client";

import React, { useRef, useEffect } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { SemanticObject, SemanticScene } from "@/types/semantic-analysis";
import type { CanvasViewportState } from "../semantic-analysis-types";
import { drawSceneOnCanvas } from "../semantic-analysis-utils";

interface AnalysisCanvasProps {
  selectedImage: string | null;
  scene: SemanticScene | null;
  selectedObject: SemanticObject | null;
  hoveredObject: string | null;
  showLabels: boolean;
  showBoundingBoxes: boolean;
  showMasks: boolean;
  viewport: CanvasViewportState;
  onObjectSelect: (obj: SemanticObject | null) => void;
  onObjectHover: (id: string | null) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function AnalysisCanvas({
  selectedImage,
  scene,
  selectedObject,
  hoveredObject,
  showLabels,
  showBoundingBoxes,
  showMasks,
  viewport,
  onObjectSelect,
  onObjectHover,
  canvasRef,
}: AnalysisCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Draw visualization on canvas
  useEffect(() => {
    if (!canvasRef.current || !selectedImage || !scene) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      drawSceneOnCanvas(ctx, img, scene, {
        hoveredObject,
        selectedObject,
        showBoundingBoxes,
        showMasks,
        showLabels,
      });
    };
    img.src = selectedImage;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typeColors is stable (defined inline but constant values)
  }, [
    selectedImage,
    scene,
    hoveredObject,
    selectedObject,
    showLabels,
    showBoundingBoxes,
    showMasks,
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!scene || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / viewport.zoom - viewport.panOffset.x;
    const y = (e.clientY - rect.top) / viewport.zoom - viewport.panOffset.y;

    const clickedObject = scene.objects.find(
      (obj) =>
        x >= obj.bounding_box.x &&
        x <= obj.bounding_box.x + obj.bounding_box.width &&
        y >= obj.bounding_box.y &&
        y <= obj.bounding_box.y + obj.bounding_box.height
    );

    onObjectSelect(clickedObject || null);
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!scene || !canvasRef.current) return;

    if (viewport.isDragging) {
      viewport.setPanOffset({
        x:
          viewport.panOffset.x +
          (e.clientX - viewport.dragStart.x) / viewport.zoom,
        y:
          viewport.panOffset.y +
          (e.clientY - viewport.dragStart.y) / viewport.zoom,
      });
      viewport.setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / viewport.zoom - viewport.panOffset.x;
    const y = (e.clientY - rect.top) / viewport.zoom - viewport.panOffset.y;

    const hoveredObj = scene.objects.find(
      (obj) =>
        x >= obj.bounding_box.x &&
        x <= obj.bounding_box.x + obj.bounding_box.width &&
        y >= obj.bounding_box.y &&
        y <= obj.bounding_box.y + obj.bounding_box.height
    );

    onObjectHover(hoveredObj?.id || null);
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-surface-canvas relative"
      style={{ cursor: viewport.isDragging ? "grabbing" : "grab" }}
    >
      {selectedImage ? (
        <div
          style={{
            transform: `scale(${viewport.zoom}) translate(${viewport.panOffset.x}px, ${viewport.panOffset.y}px)`,
            transformOrigin: "top left",
          }}
        >
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onMouseLeave={() => onObjectHover(null)}
            onMouseDown={(e) => {
              if (e.shiftKey) {
                viewport.setIsDragging(true);
                viewport.setDragStart({ x: e.clientX, y: e.clientY });
              }
            }}
            onMouseUp={() => viewport.setIsDragging(false)}
            className="max-w-full"
            style={{
              cursor: hoveredObject
                ? "pointer"
                : viewport.isDragging
                  ? "grabbing"
                  : "grab",
            }}
          />
        </div>
      ) : (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <ImageIcon className="w-12 h-12 mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-muted">
              Upload an image to begin semantic analysis
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
