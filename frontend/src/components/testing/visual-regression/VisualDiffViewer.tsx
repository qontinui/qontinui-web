"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { DiffRegion } from "@/services/testing-service";
import type { VisualDiffViewerProps } from "./types";
import { useVisualDiff } from "./_hooks/use-visual-diff";
import { ControlsBar } from "./_components/ControlsBar";
import { SideBySideView } from "./_components/SideBySideView";
import { OverlayView } from "./_components/OverlayView";
import { SwipeView } from "./_components/SwipeView";
import { BlinkView } from "./_components/BlinkView";

const DEFAULT_DIFF_REGIONS: DiffRegion[] = [];

export function VisualDiffViewer({
  baselineUrl,
  screenshotUrl,
  diffUrl,
  diffRegions = DEFAULT_DIFF_REGIONS,
  similarityScore,
  threshold,
  className,
  initialMode = "side-by-side",
}: VisualDiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    mode,
    setMode,
    overlayOpacity,
    setOverlayOpacity,
    swipePosition,
    setSwipePosition,
    blinkState,
    zoom,
    showDiffRegions,
    setShowDiffRegions,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleDownload,
  } = useVisualDiff(initialMode);

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

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <ControlsBar
        mode={mode}
        setMode={setMode}
        zoom={zoom}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        handleResetZoom={handleResetZoom}
        similarityScore={similarityScore}
        threshold={threshold}
        overlayOpacity={overlayOpacity}
        setOverlayOpacity={setOverlayOpacity}
        swipePosition={swipePosition}
        setSwipePosition={setSwipePosition}
        diffRegions={diffRegions}
        showDiffRegions={showDiffRegions}
        setShowDiffRegions={setShowDiffRegions}
      />

      <div
        ref={containerRef}
        className="relative overflow-auto rounded-lg border bg-muted/20"
        style={{ maxHeight: "70vh" }}
      >
        {mode === "side-by-side" && (
          <SideBySideView
            baselineUrl={baselineUrl}
            screenshotUrl={screenshotUrl}
            diffUrl={diffUrl}
            diffRegions={diffRegions}
            showDiffRegions={showDiffRegions}
            zoom={zoom}
            onDownload={handleDownload}
          />
        )}

        {mode === "overlay" && baselineUrl && screenshotUrl && (
          <OverlayView
            baselineUrl={baselineUrl}
            screenshotUrl={screenshotUrl}
            diffRegions={diffRegions}
            showDiffRegions={showDiffRegions}
            zoom={zoom}
            overlayOpacity={overlayOpacity}
          />
        )}

        {mode === "swipe" && baselineUrl && screenshotUrl && (
          <SwipeView
            baselineUrl={baselineUrl}
            screenshotUrl={screenshotUrl}
            diffRegions={diffRegions}
            showDiffRegions={showDiffRegions}
            zoom={zoom}
            swipePosition={swipePosition}
          />
        )}

        {mode === "blink" && (
          <BlinkView
            baselineUrl={baselineUrl}
            screenshotUrl={screenshotUrl}
            diffRegions={diffRegions}
            showDiffRegions={showDiffRegions}
            zoom={zoom}
            blinkState={blinkState}
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Use scroll to pan when zoomed in
      </p>
    </div>
  );
}

export default VisualDiffViewer;
