"use client";

import {
  Image as ImageIcon,
  AlertCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoundingBox, ViewMode } from "../state-image-modal-types";

interface StateDetailsPanelImageSectionProps {
  loading: boolean;
  error: string | null;
  showFullImage: boolean;
  onToggleFullImage: () => void;
  fullImageUrl: string | null;
  currentImageUrl: string | null;
  currentTitle: string;
  currentBbox: BoundingBox;
  viewportWidth: number;
  viewportHeight: number;
  viewMode: ViewMode;
}

export function StateDetailsPanelImageSection({
  loading,
  error,
  showFullImage,
  onToggleFullImage,
  fullImageUrl,
  currentImageUrl,
  currentTitle,
  currentBbox,
  viewportWidth,
  viewportHeight,
  viewMode,
}: StateDetailsPanelImageSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {showFullImage
            ? "Full Screenshot"
            : viewMode === "element"
              ? "Element"
              : "State"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={onToggleFullImage}
          disabled={loading || !!error}
        >
          {showFullImage ? (
            <Minimize2 className="h-3 w-3" />
          ) : (
            <Maximize2 className="h-3 w-3" />
          )}
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-muted/50 flex items-center justify-center min-h-[150px]">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
            <ImageIcon className="h-6 w-6 animate-pulse" />
            <span className="text-xs">Loading...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground p-4">
            <AlertCircle className="h-6 w-6" />
            <span className="text-xs text-center">{error}</span>
          </div>
        ) : showFullImage && fullImageUrl ? (
          <div className="relative w-full overflow-auto max-h-[300px]">
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fullImageUrl}
                alt="Full screenshot"
                className="max-w-full"
                style={{ maxHeight: "300px" }}
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
          <div className="p-2 overflow-auto max-h-[300px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImageUrl}
              alt={currentTitle}
              className="max-w-full max-h-[280px] object-contain border rounded"
              style={{ imageRendering: "crisp-edges" }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
            <ImageIcon className="h-6 w-6" />
            <span className="text-xs">No image</span>
          </div>
        )}
      </div>
    </div>
  );
}
