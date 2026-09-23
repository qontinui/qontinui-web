/**
 * State Detail View Component
 *
 * Shows the position, size, and full image of the selected state.
 */

"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Image as ImageIcon,
  AlertCircle,
  MapPin,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCroppedExtractionScreenshot } from "./_hooks/useCroppedExtractionScreenshot";

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StateAnnotation {
  id: string;
  name: string;
  bbox: BoundingBox;
  state_type: string;
  element_ids: string[];
}

interface StateDetailViewProps {
  state: StateAnnotation;
  extractionId: string;
  screenshotId: string;
  viewportWidth: number;
  viewportHeight: number;
}

export function StateDetailView({
  state,
  extractionId,
  screenshotId,
  viewportWidth,
  viewportHeight,
}: StateDetailViewProps) {
  const { fullImageUrl, croppedImageUrl, error, loading } =
    useCroppedExtractionScreenshot(extractionId, screenshotId, state.bbox, {
      outOfBounds:
        "State is outside the screenshot area (Y={y}px, screenshot height={height}px)",
      noVisibleArea: "State region has no visible area",
    });
  const [showFullImage, setShowFullImage] = useState(false);

  // Reset when state changes
  useEffect(() => {
    setShowFullImage(false);
  }, [state.id]);

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
        <span className="font-semibold text-lg truncate">{state.name}</span>
        <Badge variant="outline">{state.state_type}</Badge>
      </div>

      {/* Position & Size */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Position & Size</span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-sm">
          <div className="bg-muted rounded-md px-3 py-2 text-center">
            <div className="text-muted-foreground text-xs mb-0.5">X</div>
            <div className="font-medium">{state.bbox.x}</div>
          </div>
          <div className="bg-muted rounded-md px-3 py-2 text-center">
            <div className="text-muted-foreground text-xs mb-0.5">Y</div>
            <div className="font-medium">{state.bbox.y}</div>
          </div>
          <div className="bg-muted rounded-md px-3 py-2 text-center">
            <div className="text-muted-foreground text-xs mb-0.5">Width</div>
            <div className="font-medium">{state.bbox.width}px</div>
          </div>
          <div className="bg-muted rounded-md px-3 py-2 text-center">
            <div className="text-muted-foreground text-xs mb-0.5">Height</div>
            <div className="font-medium">{state.bbox.height}px</div>
          </div>
        </div>
      </div>

      <Separator className="mb-4 shrink-0" />

      {/* Image Section */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <span className="text-sm font-medium">
            {showFullImage ? "Full Screenshot" : "State Image"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFullImage(!showFullImage)}
            disabled={loading || !!error}
          >
            {showFullImage ? (
              <>
                <Minimize2 className="h-4 w-4 mr-1" />
                Cropped
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4 mr-1" />
                Full
              </>
            )}
          </Button>
        </div>

        <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-muted/50 flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <ImageIcon className="h-10 w-10 animate-pulse" />
              <span className="text-sm">Loading image...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground p-4">
              <AlertCircle className="h-10 w-10" />
              <span className="text-sm text-center">{error}</span>
            </div>
          ) : showFullImage && fullImageUrl ? (
            <div className="relative w-full h-full overflow-auto p-2">
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fullImageUrl}
                  alt="Full screenshot"
                  className="max-w-full max-h-full object-contain"
                />
                {/* Highlight the state region */}
                <div
                  className="absolute border-2 border-brand-primary bg-brand-primary/20 pointer-events-none"
                  style={{
                    left: `${(state.bbox.x / viewportWidth) * 100}%`,
                    top: `${(state.bbox.y / viewportHeight) * 100}%`,
                    width: `${(state.bbox.width / viewportWidth) * 100}%`,
                    height: `${(state.bbox.height / viewportHeight) * 100}%`,
                  }}
                />
              </div>
            </div>
          ) : croppedImageUrl ? (
            <div className="w-full h-full overflow-auto p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={croppedImageUrl}
                alt={state.name}
                className="max-w-full max-h-full object-contain border rounded"
                style={{ imageRendering: "crisp-edges" }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <ImageIcon className="h-10 w-10" />
              <span className="text-sm">No image available</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
