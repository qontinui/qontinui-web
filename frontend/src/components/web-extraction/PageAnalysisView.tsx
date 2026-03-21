/**
 * Page Analysis View Component
 *
 * Page-centric view of extraction results:
 * - Left sidebar: scrollable list of page thumbnails (Cyan theme)
 * - Right container: larger view of selected page with colored bounding boxes (Green theme)
 * - Legend showing state names and colors
 */

"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Loader2, FileImage, Maximize2 } from "lucide-react";
import { runnerClient } from "@/lib/runner-client";
import {
  getStateBoundingBox,
  getStateColorByIndex,
  getStateImageBoundingBox,
  unionBoundingBoxes,
} from "./utils/bbox-utils";
import type {
  ExtractionAnnotation,
  StateMachineState,
  BoundingBox,
} from "@/types/extraction";

interface PageAnalysisViewProps {
  states: StateMachineState[];
  annotations: ExtractionAnnotation[];
  extractionId?: string;
}

interface StateWithColor {
  state: StateMachineState;
  bbox: BoundingBox;
  color: { fill: string; stroke: string };
  index: number;
}

export function PageAnalysisView({
  states,
  annotations,
  extractionId,
}: PageAnalysisViewProps) {
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);
  const [screenshotCache, setScreenshotCache] = useState<Map<string, string>>(
    new Map()
  );
  const [loadingScreenshots, setLoadingScreenshots] = useState<Set<string>>(
    new Set()
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Selected annotation
  const selectedAnnotation = useMemo(
    () =>
      annotations.find((a) => a.screenshot_id === selectedAnnotationId) || null,
    [annotations, selectedAnnotationId]
  );

  // States with their bounding boxes and colors
  const statesWithColors = useMemo<StateWithColor[]>(() => {
    return states
      .map((state, index) => {
        const bbox = getStateBoundingBox(state);
        if (!bbox) return null;
        return {
          state,
          bbox,
          color: getStateColorByIndex(index),
          index,
        };
      })
      .filter((s): s is StateWithColor => s !== null);
  }, [states]);

  // Auto-select first annotation
  useEffect(() => {
    if (annotations.length > 0 && !selectedAnnotationId) {
      const firstAnnotation = annotations[0];
      if (firstAnnotation) {
        setSelectedAnnotationId(firstAnnotation.screenshot_id);
      }
    }
  }, [annotations, selectedAnnotationId]);

  // Load screenshot
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadScreenshot = async (
    screenshotId: string
  ): Promise<string | null> => {
    if (screenshotCache.has(screenshotId)) {
      return screenshotCache.get(screenshotId) || null;
    }

    if (loadingScreenshots.has(screenshotId) || !extractionId) {
      return null;
    }

    setLoadingScreenshots((prev) => new Set(prev).add(screenshotId));

    try {
      const result = await runnerClient.getExtractionScreenshot(
        extractionId,
        screenshotId
      );
      if (result.success && result.blob) {
        const url = URL.createObjectURL(result.blob);
        setScreenshotCache((prev) => new Map(prev).set(screenshotId, url));
        return url;
      }
    } catch (error) {
      console.error("Failed to load screenshot:", error);
    } finally {
      setLoadingScreenshots((prev) => {
        const next = new Set(prev);
        next.delete(screenshotId);
        return next;
      });
    }

    return null;
  };

  // Track container width for responsive canvas
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      screenshotCache.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw page with state bounding boxes
  useEffect(() => {
    if (!selectedAnnotation || !canvasRef.current || containerWidth === 0)
      return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawPage = async () => {
      const imageUrl = await loadScreenshot(selectedAnnotation.screenshot_id);
      if (!imageUrl) return;

      const img = new Image();
      img.src = imageUrl;

      img.onload = () => {
        // Calculate display size to FIT WIDTH (allow vertical scroll)
        const availableWidth = containerWidth - 32; // padding
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        const displayWidth = availableWidth;
        const displayHeight = displayWidth / aspectRatio;

        canvas.width = displayWidth;
        canvas.height = displayHeight;

        const scaleX = displayWidth / img.naturalWidth;
        const scaleY = displayHeight / img.naturalHeight;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw image
        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

        // Filter states to only those visible on this screenshot
        // and compute per-screenshot bounding boxes (not union across all screenshots)
        const screenshotId = selectedAnnotation.screenshot_id;
        const isFirstAnnotation =
          annotations.length > 0 &&
          annotations[0]?.screenshot_id === screenshotId;
        const statesForThisPage: Array<{
          state: StateMachineState;
          bbox: BoundingBox;
          color: { fill: string; stroke: string };
        }> = [];

        for (const { state, color } of statesWithColors) {
          // Get only stateImages that belong to this screenshot
          // If stateImage has no screenshotId, only show on first screenshot to avoid duplicates
          const imagesOnThisScreenshot = state.stateImages.filter((img) => {
            if (!img.screenshotId) {
              return isFirstAnnotation;
            }
            return img.screenshotId === screenshotId;
          });

          if (imagesOnThisScreenshot.length === 0) continue;

          // Compute bbox from only the images on THIS screenshot
          const bboxes = imagesOnThisScreenshot
            .map((img) => getStateImageBoundingBox(img))
            .filter((b): b is BoundingBox => b !== null);

          const screenshotBbox = unionBoundingBoxes(bboxes);
          if (!screenshotBbox) continue;

          statesForThisPage.push({
            state,
            bbox: screenshotBbox,
            color,
          });
        }

        // Draw state bounding boxes for this page only
        for (const { state, bbox, color } of statesForThisPage) {
          ctx.strokeStyle = color.stroke;
          ctx.fillStyle = color.fill;
          ctx.lineWidth = 2;

          const x = bbox.x * scaleX;
          const y = bbox.y * scaleY;
          const width = bbox.width * scaleX;
          const height = bbox.height * scaleY;

          // Fill
          ctx.fillRect(x, y, width, height);

          // Stroke
          ctx.strokeRect(x, y, width, height);

          // Label
          ctx.fillStyle = color.stroke;
          ctx.font = "bold 11px monospace";
          const textWidth = ctx.measureText(state.name).width;
          const labelHeight = 16;
          const labelY = y > labelHeight ? y - 2 : y + height + labelHeight;

          // Label background
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(x, labelY - labelHeight + 2, textWidth + 8, labelHeight);

          // Label text
          ctx.fillStyle = color.stroke;
          ctx.fillText(state.name, x + 4, labelY - 2);
        }
      };
    };

    drawPage();
  }, [
    selectedAnnotation,
    statesWithColors,
    loadScreenshot,
    screenshotCache,
    containerWidth,
    annotations,
  ]);

  return (
    <div className="grid grid-cols-12 gap-4 h-full min-h-0">
      {/* Panel 1: Pages List (Cyan) */}
      <Card className="col-span-3 bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 border-b border-brand-primary/20">
          <div className="flex items-center gap-2">
            <FileImage className="w-5 h-5 text-brand-primary" />
            <h3 className="text-brand-primary font-mono font-semibold">
              Page Index
            </h3>
          </div>
          <div className="text-[10px] text-text-muted font-mono mt-1">
            {annotations.length} CAPTURES FOUND
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {annotations.map((annotation) => (
              <PageThumbnail
                key={annotation.screenshot_id}
                annotation={annotation}
                isSelected={annotation.screenshot_id === selectedAnnotationId}
                extractionId={extractionId}
                screenshotCache={screenshotCache}
                loadScreenshot={loadScreenshot}
                onClick={() =>
                  setSelectedAnnotationId(annotation.screenshot_id)
                }
              />
            ))}
          </div>
        </ScrollArea>
      </Card>

      {/* Panel 2: Main View (Green) */}
      <Card className="col-span-9 bg-surface-raised/60 border-brand-success/30 backdrop-blur-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 border-b border-brand-success/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Maximize2 className="w-5 h-5 text-brand-success" />
            <h3 className="text-brand-success font-mono font-semibold">
              {selectedAnnotation
                ? (() => {
                    try {
                      return selectedAnnotation.source_url
                        ? new URL(selectedAnnotation.source_url).hostname
                        : "Page";
                    } catch {
                      return selectedAnnotation.source_url || "Page";
                    }
                  })()
                : "Visual Analysis"}
            </h3>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {!selectedAnnotation ? (
            <div className="flex-1 flex items-center justify-center text-text-muted italic text-xs font-mono">
              Awaiting Selection...
            </div>
          ) : (
            <>
              {/* Legend */}
              <div className="px-4 py-3 bg-surface-canvas/50 border-b border-brand-success/10">
                <div className="text-[10px] font-mono text-text-muted mb-2 uppercase tracking-tight">
                  {" "}
                  Detected States
                </div>
                <div className="flex flex-wrap gap-2">
                  {statesWithColors
                    .filter(({ state }) => {
                      const screenshotId = selectedAnnotation?.screenshot_id;
                      // Only show states that have images on this specific screenshot
                      return state.stateImages.some(
                        (img) => img.screenshotId === screenshotId
                      );
                    })
                    .map(({ state, color }) => (
                      <div
                        key={state.id}
                        className="bg-surface-canvas border border-brand-success/20 rounded-sm px-2 py-0.5 flex items-center gap-2"
                      >
                        <div
                          className="w-2 h-2 rounded-full shadow-[0_0_5px_currentColor]"
                          style={{
                            backgroundColor: color.stroke,
                            color: color.stroke,
                          }}
                        />
                        <span className="text-[10px] text-white font-mono">
                          {state.name}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Scrollable Canvas Area */}
              <ScrollArea
                className="flex-1 bg-surface-canvas/30"
                ref={containerRef}
              >
                <div className="p-6 flex justify-center">
                  {loadingScreenshots.has(selectedAnnotation.screenshot_id) ? (
                    <div className="flex flex-col items-center gap-3 py-20">
                      <Loader2 className="h-10 w-10 animate-spin text-brand-success" />
                      <span className="text-brand-success text-xs font-mono animate-pulse">
                        Scanning Page...
                      </span>
                    </div>
                  ) : (
                    <canvas
                      ref={canvasRef}
                      className="rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.5)] bg-slate-900 border border-white/5"
                    />
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// Sub-component: Page Thumbnail
interface PageThumbnailProps {
  annotation: ExtractionAnnotation;
  isSelected: boolean;
  extractionId?: string;
  screenshotCache: Map<string, string>;
  loadScreenshot: (screenshotId: string) => Promise<string | null>;
  onClick: () => void;
}

function PageThumbnail({
  annotation,
  isSelected,
  extractionId,
  screenshotCache,
  loadScreenshot,
  onClick,
}: PageThumbnailProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load screenshot
  useEffect(() => {
    if (!extractionId) {
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      const url = await loadScreenshot(annotation.screenshot_id);
      setImageUrl(url);
      setIsLoading(false);
    };

    if (screenshotCache.has(annotation.screenshot_id)) {
      setImageUrl(screenshotCache.get(annotation.screenshot_id) || null);
      setIsLoading(false);
    } else {
      load();
    }
  }, [extractionId, annotation.screenshot_id, loadScreenshot, screenshotCache]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
      className={`
        rounded-lg border cursor-pointer transition-all overflow-hidden relative
        ${
          isSelected
            ? "border-brand-primary shadow-[0_0_15px_rgba(0,217,255,0.3)] ring-1 ring-brand-primary/50"
            : "border-brand-primary/20 bg-surface-canvas/50 hover:border-brand-primary/50"
        }
      `}
    >
      <div className="aspect-video bg-surface-canvas">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-brand-primary/40" />
          </div>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={annotation.source_url}
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${isSelected ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileImage className="h-4 w-4 text-brand-primary/20" />
          </div>
        )}
      </div>
      <div
        className={`p-1.5 ${isSelected ? "bg-brand-primary/20" : "bg-surface-canvas/70"}`}
      >
        <div
          className={`text-[9px] font-mono truncate uppercase ${isSelected ? "text-brand-primary" : "text-text-muted"}`}
        >
          {(() => {
            try {
              return annotation.source_url
                ? new URL(annotation.source_url).hostname
                : "Unknown Host";
            } catch {
              return annotation.source_url || "Unknown Host";
            }
          })()}
        </div>
      </div>
    </div>
  );
}
