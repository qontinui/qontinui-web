"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  SplitSquareVertical,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiffRegion } from "@/services/testing-service";

type ViewMode = "side-by-side" | "overlay" | "swipe" | "blink";

interface VisualDiffViewerProps {
  baselineUrl: string | null;
  screenshotUrl: string | null;
  diffUrl?: string | null;
  diffRegions?: DiffRegion[];
  similarityScore?: number;
  threshold?: number;
  className?: string;
  initialMode?: ViewMode;
}

/**
 * VisualDiffViewer - Compare baseline and screenshot images
 *
 * Features:
 * - Side-by-side comparison with sync scrolling
 * - Overlay with opacity slider
 * - Swipe slider to reveal
 * - Blink toggle between images
 * - Zoom controls
 * - Diff region highlighting
 * - Download images
 */
export function VisualDiffViewer({
  baselineUrl,
  screenshotUrl,
  diffUrl,
  diffRegions = [],
  similarityScore,
  threshold,
  className,
  initialMode = "side-by-side",
}: VisualDiffViewerProps) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [swipePosition, setSwipePosition] = useState(50);
  const [blinkState, setBlinkState] = useState<"baseline" | "screenshot">(
    "baseline"
  );
  const [zoom, setZoom] = useState(1);
  const [showDiffRegions, setShowDiffRegions] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const blinkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Blink mode interval
  useEffect(() => {
    if (mode === "blink") {
      blinkIntervalRef.current = setInterval(() => {
        setBlinkState((prev) =>
          prev === "baseline" ? "screenshot" : "baseline"
        );
      }, 500);
    } else {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
    }

    return () => {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
      }
    };
  }, [mode]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 4));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  const handleDownload = async (url: string, name: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${name}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  if (!baselineUrl && !screenshotUrl) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-8 bg-muted/30 rounded-lg",
          className
        )}
      >
        <p className="text-muted-foreground">No images available</p>
      </div>
    );
  }

  const renderDiffRegionOverlays = () => {
    if (!showDiffRegions || diffRegions.length === 0) return null;

    return (
      <div className="absolute inset-0 pointer-events-none">
        {diffRegions.map((region, index) => (
          <div
            key={index}
            className="absolute border-2 border-red-500 bg-red-500/20"
            style={{
              left: `${region.x}px`,
              top: `${region.y}px`,
              width: `${region.width}px`,
              height: `${region.height}px`,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
            title={`Change: ${(region.change_percentage * 100).toFixed(1)}%`}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-ui-id="testing-visual-diff-viewer"
    >
      {/* Controls Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Mode Selector */}
        <div
          className="flex items-center gap-1 border rounded-lg p-1"
          data-ui-id="testing-visual-diff-mode-selector"
        >
          <Button
            variant={mode === "side-by-side" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("side-by-side")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-sidebyside-btn"
          >
            <SplitSquareVertical className="h-4 w-4 mr-1" />
            Side by Side
          </Button>
          <Button
            variant={mode === "overlay" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("overlay")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-overlay-btn"
          >
            <Layers className="h-4 w-4 mr-1" />
            Overlay
          </Button>
          <Button
            variant={mode === "swipe" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("swipe")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-swipe-btn"
          >
            <Maximize2 className="h-4 w-4 mr-1" />
            Swipe
          </Button>
          <Button
            variant={mode === "blink" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("blink")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-blink-btn"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Blink
          </Button>
        </div>

        {/* Status Badge */}
        {similarityScore !== undefined && (
          <div className="flex items-center gap-2">
            <Badge
              variant={
                similarityScore >= (threshold || 0.95)
                  ? "default"
                  : "destructive"
              }
            >
              {(similarityScore * 100).toFixed(1)}% match
            </Badge>
            {threshold !== undefined && (
              <span className="text-xs text-muted-foreground">
                (threshold: {(threshold * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            disabled={zoom <= 0.25}
            className="h-8 w-8 p-0"
            data-ui-id="testing-visual-diff-zoom-out-btn"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs px-2 min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            disabled={zoom >= 4}
            className="h-8 w-8 p-0"
            data-ui-id="testing-visual-diff-zoom-in-btn"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetZoom}
            className="h-8 px-2"
            data-ui-id="testing-visual-diff-zoom-reset-btn"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Mode-specific controls */}
      {mode === "overlay" && (
        <div className="flex items-center gap-4 px-2">
          <span className="text-sm text-muted-foreground">Baseline</span>
          <Slider
            value={[overlayOpacity * 100]}
            onValueChange={([value]) => setOverlayOpacity((value ?? 0) / 100)}
            max={100}
            step={1}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground">Screenshot</span>
        </div>
      )}

      {mode === "swipe" && (
        <div className="flex items-center gap-4 px-2">
          <span className="text-sm text-muted-foreground">Baseline</span>
          <Slider
            value={[swipePosition]}
            onValueChange={([value]) => setSwipePosition(value ?? 0)}
            max={100}
            step={1}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground">Screenshot</span>
        </div>
      )}

      {/* Diff regions toggle */}
      {diffRegions.length > 0 && (
        <div className="flex items-center gap-2 px-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showDiffRegions}
              onChange={(e) => setShowDiffRegions(e.target.checked)}
              className="rounded"
            />
            Show diff regions ({diffRegions.length})
          </label>
        </div>
      )}

      {/* Image Viewer */}
      <div
        ref={containerRef}
        className="relative overflow-auto rounded-lg border bg-muted/20"
        style={{ maxHeight: "70vh" }}
      >
        {mode === "side-by-side" && (
          <div className="flex gap-4 p-4">
            {/* Baseline */}
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Baseline</span>
                {baselineUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(baselineUrl, "baseline")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="relative overflow-hidden rounded-lg border bg-background">
                {baselineUrl ? (
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <Image
                      src={baselineUrl}
                      alt="Baseline"
                      width={800}
                      height={600}
                      className="w-full h-auto"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-muted-foreground">
                    No baseline
                  </div>
                )}
              </div>
            </div>

            {/* Screenshot */}
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Screenshot</span>
                {screenshotUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(screenshotUrl, "screenshot")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="relative overflow-hidden rounded-lg border bg-background">
                {screenshotUrl ? (
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <Image
                      src={screenshotUrl}
                      alt="Screenshot"
                      width={800}
                      height={600}
                      className="w-full h-auto"
                    />
                    {renderDiffRegionOverlays()}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-muted-foreground">
                    No screenshot
                  </div>
                )}
              </div>
            </div>

            {/* Diff Image */}
            {diffUrl && (
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Diff</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(diffUrl, "diff")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                <div className="relative overflow-hidden rounded-lg border bg-background">
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <Image
                      src={diffUrl}
                      alt="Diff"
                      width={800}
                      height={600}
                      className="w-full h-auto"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "overlay" && baselineUrl && screenshotUrl && (
          <div className="relative p-4">
            <div
              className="relative"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              {/* Baseline as background */}
              <Image
                src={baselineUrl}
                alt="Baseline"
                width={800}
                height={600}
                className="w-full h-auto"
              />
              {/* Screenshot overlay */}
              <div
                className="absolute inset-0"
                style={{ opacity: overlayOpacity }}
              >
                <Image
                  src={screenshotUrl}
                  alt="Screenshot"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                />
              </div>
              {renderDiffRegionOverlays()}
            </div>
          </div>
        )}

        {mode === "swipe" && baselineUrl && screenshotUrl && (
          <div className="relative p-4">
            <div
              className="relative overflow-hidden"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              {/* Screenshot full */}
              <Image
                src={screenshotUrl}
                alt="Screenshot"
                width={800}
                height={600}
                className="w-full h-auto"
              />
              {/* Baseline clipped */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
              >
                <Image
                  src={baselineUrl}
                  alt="Baseline"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                />
              </div>
              {/* Swipe line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary"
                style={{ left: `${swipePosition}%` }}
              />
              {renderDiffRegionOverlays()}
            </div>
          </div>
        )}

        {mode === "blink" && (
          <div className="relative p-4">
            <div
              className="relative"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              {blinkState === "baseline" && baselineUrl ? (
                <Image
                  src={baselineUrl}
                  alt="Baseline"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                />
              ) : screenshotUrl ? (
                <>
                  <Image
                    src={screenshotUrl}
                    alt="Screenshot"
                    width={800}
                    height={600}
                    className="w-full h-auto"
                  />
                  {renderDiffRegionOverlays()}
                </>
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-foreground">
                  No image
                </div>
              )}
            </div>
            <div className="absolute top-6 left-6">
              <Badge variant="outline">
                {blinkState === "baseline" ? "Baseline" : "Screenshot"}
              </Badge>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard hints */}
      <p className="text-xs text-muted-foreground text-center">
        Use scroll to pan when zoomed in
      </p>
    </div>
  );
}

export default VisualDiffViewer;
