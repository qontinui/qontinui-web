/**
 * State Detail View Component
 *
 * Shows the position, size, and full image of the selected state.
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { runnerClient } from "@/lib/runner-client";

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
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullImage, setShowFullImage] = useState(false);

  const blobUrlRef = useRef<string | null>(null);

  const cleanupBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  // Reset when state changes
  useEffect(() => {
    setShowFullImage(false);
  }, [state.id]);

  // Load and crop screenshot
  useEffect(() => {
    let mounted = true;

    async function loadAndCropScreenshot() {
      try {
        setLoading(true);
        setError(null);

        const result = await runnerClient.getExtractionScreenshot(
          extractionId,
          screenshotId
        );

        if (!mounted) return;

        if (!result.success || !result.blob) {
          setError(result.error || "Failed to load screenshot");
          setLoading(false);
          return;
        }

        cleanupBlobUrl();

        const fullUrl = URL.createObjectURL(result.blob);
        blobUrlRef.current = fullUrl;
        setFullImageUrl(fullUrl);

        const img = new Image();

        img.onload = () => {
          if (!mounted) return;

          const isOutOfBounds =
            state.bbox.y >= img.height ||
            state.bbox.x >= img.width ||
            state.bbox.y + state.bbox.height <= 0 ||
            state.bbox.x + state.bbox.width <= 0;

          if (isOutOfBounds) {
            setError(
              `State is outside the screenshot area (Y=${state.bbox.y}px, screenshot height=${img.height}px)`
            );
            setLoading(false);
            return;
          }

          const visibleBbox = {
            x: Math.max(0, state.bbox.x),
            y: Math.max(0, state.bbox.y),
            width: Math.min(
              state.bbox.width,
              img.width - Math.max(0, state.bbox.x)
            ),
            height: Math.min(
              state.bbox.height,
              img.height - Math.max(0, state.bbox.y)
            ),
          };

          visibleBbox.width = Math.min(
            visibleBbox.width,
            img.width - visibleBbox.x
          );
          visibleBbox.height = Math.min(
            visibleBbox.height,
            img.height - visibleBbox.y
          );

          if (visibleBbox.width <= 0 || visibleBbox.height <= 0) {
            setError("State region has no visible area");
            setLoading(false);
            return;
          }

          const canvas = document.createElement("canvas");
          canvas.width = visibleBbox.width;
          canvas.height = visibleBbox.height;
          const ctx = canvas.getContext("2d");

          if (ctx) {
            ctx.drawImage(
              img,
              visibleBbox.x,
              visibleBbox.y,
              visibleBbox.width,
              visibleBbox.height,
              0,
              0,
              visibleBbox.width,
              visibleBbox.height
            );

            setCroppedImageUrl(canvas.toDataURL("image/png"));
          }

          setLoading(false);
        };

        img.onerror = () => {
          if (!mounted) return;
          setError("Failed to process screenshot");
          setLoading(false);
        };

        img.src = fullUrl;
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load screenshot");
        setLoading(false);
      }
    }

    loadAndCropScreenshot();

    return () => {
      mounted = false;
    };
  }, [
    extractionId,
    screenshotId,
    state.bbox.x,
    state.bbox.y,
    state.bbox.width,
    state.bbox.height,
    state.id,
    cleanupBlobUrl,
  ]);

  useEffect(() => {
    return () => {
      cleanupBlobUrl();
    };
  }, [cleanupBlobUrl]);

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
