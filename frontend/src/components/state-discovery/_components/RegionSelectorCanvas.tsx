/**
 * Canvas area for RegionSelector: image display, selection overlays, resize handles
 */

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CropIcon } from "lucide-react";
import { Region } from "../region-selector-types";

interface RegionSelectorCanvasProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  scale: number;
  isSelecting: boolean;
  isDragging: boolean;
  currentRegion: Region | null;
  tempRegion: Region | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
}

/** Compute the CSS left/top for a region overlay centered within the container */
function regionLeft(imageWidth: number, scale: number, regionX: number) {
  return `calc(50% - ${(imageWidth * scale) / 2}px + ${regionX * scale}px)`;
}
function regionTop(imageHeight: number, scale: number, regionY: number) {
  return `calc(50% - ${(imageHeight * scale) / 2}px + ${regionY * scale}px)`;
}

const ResizeHandles: React.FC = () => (
  <>
    <div
      className="absolute -left-1 -top-1 w-2 h-2 bg-blue-500 cursor-nw-resize"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute left-1/2 -top-1 w-2 h-2 bg-blue-500 cursor-n-resize -translate-x-1/2"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute -right-1 -top-1 w-2 h-2 bg-blue-500 cursor-ne-resize"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute -right-1 top-1/2 w-2 h-2 bg-blue-500 cursor-e-resize -translate-y-1/2"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute -right-1 -bottom-1 w-2 h-2 bg-blue-500 cursor-se-resize"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute left-1/2 -bottom-1 w-2 h-2 bg-blue-500 cursor-s-resize -translate-x-1/2"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute -left-1 -bottom-1 w-2 h-2 bg-blue-500 cursor-sw-resize"
      style={{ pointerEvents: "auto" }}
    />
    <div
      className="absolute -left-1 top-1/2 w-2 h-2 bg-blue-500 cursor-w-resize -translate-y-1/2"
      style={{ pointerEvents: "auto" }}
    />
  </>
);

const RegionSelectorCanvas: React.FC<RegionSelectorCanvasProps> = ({
  containerRef,
  imageUrl,
  imageWidth,
  imageHeight,
  scale,
  isSelecting,
  isDragging,
  currentRegion,
  tempRegion,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}) => {
  return (
    <Card>
      <CardContent className="p-0">
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              (e.currentTarget as HTMLElement).click();
            }
          }}
          ref={containerRef}
          className="relative overflow-hidden bg-surface-raised border-2 border-border-default"
          style={{
            height: "400px",
            cursor: isSelecting
              ? "crosshair"
              : isDragging
                ? "move"
                : "crosshair",
            userSelect: "none",
            minHeight: "400px",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Screenshot"
              style={{
                width: imageWidth * scale,
                height: imageHeight * scale,
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Temporary selection rectangle during drawing */}
          {isSelecting && tempRegion && !currentRegion && (
            <div
              className="absolute border-2 border-blue-400 bg-blue-400 bg-opacity-10"
              style={{
                left: regionLeft(imageWidth, scale, tempRegion.x),
                top: regionTop(imageHeight, scale, tempRegion.y),
                width: tempRegion.width * scale,
                height: tempRegion.height * scale,
                pointerEvents: "none",
              }}
            />
          )}

          {/* Selection rectangle */}
          {currentRegion && (
            <div
              className="absolute border-2 border-blue-500 bg-blue-500 bg-opacity-20"
              style={{
                left: regionLeft(imageWidth, scale, currentRegion.x),
                top: regionTop(imageHeight, scale, currentRegion.y),
                width: currentRegion.width * scale,
                height: currentRegion.height * scale,
                pointerEvents: "none",
              }}
            >
              <ResizeHandles />
              {/* Size label */}
              <div className="absolute -top-6 left-0 text-xs bg-blue-500 text-white px-1 rounded">
                {Math.round(currentRegion.width)}&times;
                {Math.round(currentRegion.height)}
              </div>
            </div>
          )}

          {/* Instructions overlay when no image */}
          {!imageUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted">
              <div className="text-center">
                <CropIcon className="h-12 w-12 mx-auto mb-2" />
                <p>Upload screenshots to select analysis region</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default RegionSelectorCanvas;
