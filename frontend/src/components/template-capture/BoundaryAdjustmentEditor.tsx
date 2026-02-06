/**
 * BoundaryAdjustmentEditor Component
 *
 * Interactive editor for adjusting detected element boundaries.
 *
 * Features:
 * - Drag handles to resize/move boundary
 * - Show alternative boundaries as suggestions
 * - Live preview of extracted template
 * - Zoom/pan for detailed adjustment
 */

import React, { useState, useRef, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type {
  TemplateCandidate,
  CandidateBoundingBox,
} from "@/services/template-capture-service";

export interface BoundaryAdjustmentEditorProps {
  candidate: TemplateCandidate;
  imageUrl: string;
  onSave: (adjustedBoundary: CandidateBoundingBox) => void;
  onCancel: () => void;
}

interface DragState {
  type: "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | null;
  startX: number;
  startY: number;
  startBoundary: CandidateBoundingBox;
}

export function BoundaryAdjustmentEditor({
  candidate,
  imageUrl,
  onSave,
  onCancel,
}: BoundaryAdjustmentEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan] = useState({ x: 0, y: 0 });
  const [boundary, setBoundary] = useState<CandidateBoundingBox>(
    candidate.adjusted_boundary || candidate.primary_boundary
  );
  const [dragState, setDragState] = useState<DragState>({
    type: null,
    startX: 0,
    startY: 0,
    startBoundary: boundary,
  });
  const [showAlternatives, setShowAlternatives] = useState(true);

  // Handle image load
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setImageLoaded(true);

      // Center the boundary in view
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const initialZoom = Math.min(
          (containerRect.width * 0.8) / boundary.width,
          (containerRect.height * 0.8) / boundary.height,
          2
        );
        setZoom(Math.max(0.5, Math.min(initialZoom, 3)));
      }
    },
    [boundary]
  );

  // Mouse handlers for drag operations
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: DragState["type"]) => {
      e.preventDefault();
      e.stopPropagation();
      setDragState({
        type,
        startX: e.clientX,
        startY: e.clientY,
        startBoundary: { ...boundary },
      });
    },
    [boundary]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState.type) return;

      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;

      setBoundary(() => {
        const newBoundary = { ...dragState.startBoundary };

        switch (dragState.type) {
          case "move":
            newBoundary.x = Math.max(0, dragState.startBoundary.x + dx);
            newBoundary.y = Math.max(0, dragState.startBoundary.y + dy);
            break;
          case "resize-nw":
            newBoundary.x = Math.max(0, dragState.startBoundary.x + dx);
            newBoundary.y = Math.max(0, dragState.startBoundary.y + dy);
            newBoundary.width = Math.max(
              10,
              dragState.startBoundary.width - dx
            );
            newBoundary.height = Math.max(
              10,
              dragState.startBoundary.height - dy
            );
            break;
          case "resize-ne":
            newBoundary.y = Math.max(0, dragState.startBoundary.y + dy);
            newBoundary.width = Math.max(
              10,
              dragState.startBoundary.width + dx
            );
            newBoundary.height = Math.max(
              10,
              dragState.startBoundary.height - dy
            );
            break;
          case "resize-sw":
            newBoundary.x = Math.max(0, dragState.startBoundary.x + dx);
            newBoundary.width = Math.max(
              10,
              dragState.startBoundary.width - dx
            );
            newBoundary.height = Math.max(
              10,
              dragState.startBoundary.height + dy
            );
            break;
          case "resize-se":
            newBoundary.width = Math.max(
              10,
              dragState.startBoundary.width + dx
            );
            newBoundary.height = Math.max(
              10,
              dragState.startBoundary.height + dy
            );
            break;
        }

        return newBoundary;
      });
    },
    [dragState, zoom]
  );

  const handleMouseUp = useCallback(() => {
    setDragState((prev) => ({ ...prev, type: null }));
  }, []);

  // Select alternative boundary
  const selectAlternative = useCallback((alt: CandidateBoundingBox) => {
    setBoundary(alt);
  }, []);

  // Reset to original
  const resetBoundary = useCallback(() => {
    setBoundary(candidate.primary_boundary);
  }, [candidate.primary_boundary]);

  // Zoom controls
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.25, 5)), []);
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(z / 1.25, 0.25)),
    []
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Adjust Template Boundary</DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 py-2 border-b">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={zoomOut}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Slider
              value={[zoom]}
              min={0.25}
              max={5}
              step={0.1}
              className="w-32"
              onValueChange={([v]) => v !== undefined && setZoom(v)}
            />
            <Button variant="outline" size="sm" onClick={zoomIn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground ml-2">
              {Math.round(zoom * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetBoundary}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            {candidate.alternative_boundaries &&
              candidate.alternative_boundaries.length > 0 && (
                <Button
                  variant={showAlternatives ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowAlternatives(!showAlternatives)}
                >
                  Show Alternatives ({candidate.alternative_boundaries.length})
                </Button>
              )}
          </div>
        </div>

        {/* Canvas Area */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden bg-muted/30"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            className="absolute"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            {/* Image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Template source"
              className="max-w-none"
              onLoad={handleImageLoad}
              draggable={false}
            />

            {imageLoaded && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: imageSize.width, height: imageSize.height }}
              >
                {/* Alternative boundaries */}
                {showAlternatives &&
                  candidate.alternative_boundaries?.map((alt, i) => (
                    <g key={i}>
                      <rect
                        x={alt.x}
                        y={alt.y}
                        width={alt.width}
                        height={alt.height}
                        fill="none"
                        stroke="rgba(156, 163, 175, 0.5)"
                        strokeWidth={2 / zoom}
                        strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                        className="pointer-events-auto cursor-pointer hover:stroke-blue-400"
                        onClick={() => selectAlternative(alt)}
                      />
                      <text
                        x={alt.x + 4}
                        y={alt.y - 4}
                        fontSize={12 / zoom}
                        fill="rgba(156, 163, 175, 0.8)"
                      >
                        {alt.strategy} ({Math.round(alt.confidence * 100)}%)
                      </text>
                    </g>
                  ))}

                {/* Main boundary */}
                <rect
                  x={boundary.x}
                  y={boundary.y}
                  width={boundary.width}
                  height={boundary.height}
                  fill="rgba(59, 130, 246, 0.1)"
                  stroke="rgb(59, 130, 246)"
                  strokeWidth={2 / zoom}
                  className="pointer-events-auto cursor-move"
                  onMouseDown={(e) => handleMouseDown(e, "move")}
                />

                {/* Resize handles */}
                {(
                  [
                    ["nw", boundary.x, boundary.y],
                    ["ne", boundary.x + boundary.width, boundary.y],
                    ["sw", boundary.x, boundary.y + boundary.height],
                    [
                      "se",
                      boundary.x + boundary.width,
                      boundary.y + boundary.height,
                    ],
                  ] as const
                ).map(([dir, cx, cy]) => (
                  <circle
                    key={dir}
                    cx={cx}
                    cy={cy}
                    r={6 / zoom}
                    fill="white"
                    stroke="rgb(59, 130, 246)"
                    strokeWidth={2 / zoom}
                    className={cn(
                      "pointer-events-auto",
                      dir === "nw" && "cursor-nwse-resize",
                      dir === "ne" && "cursor-nesw-resize",
                      dir === "sw" && "cursor-nesw-resize",
                      dir === "se" && "cursor-nwse-resize"
                    )}
                    onMouseDown={(e) =>
                      handleMouseDown(e, `resize-${dir}` as DragState["type"])
                    }
                  />
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* Info Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
          <div className="flex items-center gap-4">
            <span className="text-sm">
              Position: ({Math.round(boundary.x)}, {Math.round(boundary.y)})
            </span>
            <span className="text-sm">
              Size: {Math.round(boundary.width)} x {Math.round(boundary.height)}
            </span>
            <Badge variant="outline">{boundary.strategy}</Badge>
          </div>
          <span className="text-sm text-muted-foreground">
            Click: ({candidate.click_x}, {candidate.click_y})
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={() => onSave(boundary)}>
            <Check className="h-4 w-4 mr-2" />
            Save & Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
