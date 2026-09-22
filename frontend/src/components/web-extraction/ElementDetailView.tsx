/**
 * Element Detail View Component
 *
 * Shows only the cropped image of the selected element.
 */

"use client";

import { useState, useEffect } from "react";
import {
  Image as ImageIcon,
  AlertCircle,
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

interface ElementAnnotation {
  id: string;
  name?: string | null;
  element_type: string;
  bbox: BoundingBox;
  text?: string | null;
  selector?: string | null;
  confidence?: number;
}

interface ElementDetailViewProps {
  element: ElementAnnotation;
  extractionId: string;
  screenshotId: string;
  viewportWidth: number;
  viewportHeight: number;
}

export function ElementDetailView({
  element,
  extractionId,
  screenshotId,
  viewportWidth,
  viewportHeight,
}: ElementDetailViewProps) {
  const { fullImageUrl, croppedImageUrl, error, loading } =
    useCroppedExtractionScreenshot(extractionId, screenshotId, element.bbox, {
      outOfBounds: "Element is outside the screenshot area",
      noVisibleArea: "Element region has no visible area",
    });
  const [showFullImage, setShowFullImage] = useState(false);

  // Reset when element changes
  useEffect(() => {
    setShowFullImage(false);
  }, [element.id]);

  return (
    <div className="h-full flex flex-col p-3">
      {/* Toggle Button */}
      <div className="flex justify-end mb-2 shrink-0">
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

      {/* Image */}
      <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-muted/50 flex items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-10 w-10 animate-pulse" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground p-4">
            <AlertCircle className="h-10 w-10" />
            <span className="text-sm text-center">{error}</span>
          </div>
        ) : showFullImage && fullImageUrl ? (
          <div className="w-full h-full overflow-auto p-2">
            <div
              className="relative w-full"
              style={{
                aspectRatio: `${viewportWidth} / ${viewportHeight}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fullImageUrl}
                alt="Full screenshot"
                className="w-full h-full object-contain"
              />
              {/* Highlight the element region with pulsating animation */}
              <div
                className="absolute border-2 border-brand-primary pointer-events-none z-10"
                style={{
                  left: `${(element.bbox.x / viewportWidth) * 100}%`,
                  top: `${(element.bbox.y / viewportHeight) * 100}%`,
                  width: `${(element.bbox.width / viewportWidth) * 100}%`,
                  height: `${(element.bbox.height / viewportHeight) * 100}%`,
                  animation: "element-pulse 1.5s ease-in-out infinite",
                }}
              />
              <style>{`
                @keyframes element-pulse {
                  0%, 100% {
                    box-shadow: 0 0 0 0 rgba(0, 217, 255, 0.7), inset 0 0 0 0 rgba(0, 217, 255, 0.1);
                    background-color: rgba(0, 217, 255, 0.1);
                  }
                  50% {
                    box-shadow: 0 0 12px 4px rgba(0, 217, 255, 0.5), inset 0 0 8px 2px rgba(0, 217, 255, 0.2);
                    background-color: rgba(0, 217, 255, 0.25);
                  }
                }
              `}</style>
            </div>
          </div>
        ) : croppedImageUrl ? (
          <div className="w-full h-full overflow-auto p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={croppedImageUrl}
              alt="Element"
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
  );
}
