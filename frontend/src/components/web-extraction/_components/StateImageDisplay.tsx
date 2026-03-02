"use client";

import { useState } from "react";
import {
  Image as ImageIcon,
  AlertCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoundingBox, ViewMode } from "../state-image-modal-types";

interface StateImageDisplayProps {
  loading: boolean;
  error: string | null;
  fullImageUrl: string | null;
  currentImageUrl: string | null;
  currentTitle: string;
  currentBbox: BoundingBox;
  viewMode: ViewMode;
  viewportWidth: number;
  viewportHeight: number;
}

export function StateImageDisplay({
  loading,
  error,
  fullImageUrl,
  currentImageUrl,
  currentTitle,
  currentBbox,
  viewMode,
  viewportWidth,
  viewportHeight,
}: StateImageDisplayProps) {
  const [showFullImage, setShowFullImage] = useState(false);

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">
          {showFullImage
            ? "Full Screenshot"
            : viewMode === "element"
              ? "Element Image"
              : "State Image"}
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
              Show Cropped
            </>
          ) : (
            <>
              <Maximize2 className="h-4 w-4 mr-1" />
              Show Full
            </>
          )}
        </Button>
      </div>

      <div className="flex-1 border rounded-lg overflow-hidden bg-muted/50 flex items-center justify-center min-h-[300px]">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8 animate-pulse" />
            <span className="text-sm">Loading image...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground p-4">
            <AlertCircle className="h-8 w-8" />
            <span className="text-sm text-center">{error}</span>
            <span className="text-xs">Make sure the runner is connected</span>
          </div>
        ) : showFullImage && fullImageUrl ? (
          <div className="relative w-full h-full overflow-auto">
            <div className="relative inline-block min-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fullImageUrl}
                alt="Full screenshot"
                className="max-w-none"
                style={{ maxHeight: "500px" }}
              />
              <div
                className="absolute border-2 border-brand-primary bg-brand-primary/20 pointer-events-none"
                style={{
                  left: `${(currentBbox.x / viewportWidth) * 100}%`,
                  top: `${(currentBbox.y / viewportHeight) * 100}%`,
                  width: `${(currentBbox.width / viewportWidth) * 100}%`,
                  height: `${(currentBbox.height / viewportHeight) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : currentImageUrl ? (
          <div className="flex items-center justify-center p-4 w-full h-full overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImageUrl}
              alt={currentTitle}
              className="max-w-full max-h-[400px] object-contain border rounded"
              style={{ imageRendering: "crisp-edges" }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
            <span className="text-sm">
              {viewMode === "element"
                ? "Element is outside screenshot bounds"
                : "No image available"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
