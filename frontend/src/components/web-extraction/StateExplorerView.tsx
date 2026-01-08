/**
 * State Explorer View Component
 *
 * State-centric view of extraction results:
 * 1. State list (Discovery Archive) - Cyan theme
 * 2. State images (Signatures) - Purple theme
 * 3. Main canvas (Visual Feed) - Green theme with floating HUD
 * 4. Screenshot history (Temporal Strip) - Cyan theme
 */

"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Image as ImageIcon,
  FileImage,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Maximize2,
} from "lucide-react";
import { runnerClient } from "@/lib/runner-client";
import { getStateImageBoundingBox } from "./utils/bbox-utils";
import type {
  ExtractionAnnotation,
  StateMachineState,
  StateMachineStateImage,
  BoundingBox,
} from "@/types/extraction";

interface StateExplorerViewProps {
  states: StateMachineState[];
  annotations: ExtractionAnnotation[];
  extractionId?: string;
}

interface ImageWithBbox {
  stateImage: StateMachineStateImage;
  bbox: BoundingBox;
}

export function StateExplorerView({
  states,
  annotations,
  extractionId,
}: StateExplorerViewProps) {
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<
    string | null
  >(null);
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Screenshot cache
  const [screenshotCache, setScreenshotCache] = useState<Map<string, string>>(
    new Map()
  );
  const [loadingScreenshots, setLoadingScreenshots] = useState<Set<string>>(
    new Set()
  );

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Selected state
  const selectedState = useMemo(
    () => states.find((s) => s.id === selectedStateId) || null,
    [states, selectedStateId]
  );

  // Filtered states
  const filteredStates = useMemo(() => {
    if (!searchQuery) return states;
    return states.filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [states, searchQuery]);

  // Images with their bounding boxes for the selected state
  const imagesWithBboxes = useMemo<ImageWithBbox[]>(() => {
    if (!selectedState) return [];
    return selectedState.stateImages
      .map((stateImage) => {
        const bbox = getStateImageBoundingBox(stateImage);
        if (!bbox) return null;
        return { stateImage, bbox };
      })
      .filter((item): item is ImageWithBbox => item !== null);
  }, [selectedState]);

  // Get unique screenshot IDs for the selected state's images
  const stateScreenshotIds = useMemo(() => {
    if (!selectedState) return [];
    const ids = new Set<string>();
    for (const img of selectedState.stateImages) {
      if (img.screenshotId) {
        ids.add(img.screenshotId);
      }
    }
    // If no screenshotIds found, use first annotation
    if (ids.size === 0 && annotations.length > 0 && annotations[0]) {
      ids.add(annotations[0].screenshot_id);
    }
    return Array.from(ids);
  }, [selectedState, annotations]);

  // Auto-select first state
  useEffect(() => {
    if (states.length > 0 && !selectedStateId) {
      const firstState = states[0];
      if (firstState) {
        setSelectedStateId(firstState.id);
      }
    }
  }, [states, selectedStateId]);

  // Auto-select first screenshot when state changes
  useEffect(() => {
    if (stateScreenshotIds.length > 0) {
      setSelectedScreenshotId(stateScreenshotIds[0] || null);
      // Reset zoom/pan when state changes
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setSelectedScreenshotId(null);
    }
  }, [stateScreenshotIds]);

  // Load screenshot
  const loadScreenshot = useCallback(
    async (screenshotId: string): Promise<string | null> => {
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
    },
    [screenshotCache, loadingScreenshots, extractionId]
  );

  // Preload screenshots for selected state
  useEffect(() => {
    if (!extractionId) return;
    for (const ssId of stateScreenshotIds) {
      loadScreenshot(ssId);
    }
  }, [stateScreenshotIds, extractionId, loadScreenshot]);

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
  }, []);

  useEffect(() => {
    if (!selectedScreenshotId || !canvasRef.current || containerWidth === 0)
      return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageUrl = screenshotCache.get(selectedScreenshotId);
    if (!imageUrl) return;

    const img = new Image();
    img.src = imageUrl;

    img.onload = () => {
      // Calculate display size to fill container width
      const availableWidth = containerWidth - 32; // padding (p-4 + p-4)
      const aspectRatio = img.naturalWidth / img.naturalHeight;

      const displayWidth = availableWidth;
      const displayHeight = displayWidth / aspectRatio;

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      const scaleX = displayWidth / img.naturalWidth;
      const scaleY = displayHeight / img.naturalHeight;

      // Clear and set up transform
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Apply zoom and pan
      ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // Draw image
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

      // Filter images to only those visible on this screenshot
      const imagesOnThisScreenshot = imagesWithBboxes.filter(
        ({ stateImage }) => {
          if (stateImage.screenshotId) {
            return stateImage.screenshotId === selectedScreenshotId;
          }
          // If no screenshotId, show on all screenshots
          return true;
        }
      );

      // Neon Colors (Matching v0 elements)
      const defaultStroke = "#00D9FF";
      const defaultFill = "rgba(0, 217, 255, 0.1)";
      const highlightStroke = "#00FF88"; // Green for highlights
      const highlightFill = "rgba(0, 255, 136, 0.25)";

      // Draw bounding boxes for all images
      for (const { stateImage, bbox } of imagesOnThisScreenshot) {
        const x = bbox.x * scaleX;
        const y = bbox.y * scaleY;
        const width = bbox.width * scaleX;
        const height = bbox.height * scaleY;
        const isHovered = stateImage.id === hoveredImageId;

        // Fill
        ctx.fillStyle = isHovered ? highlightFill : defaultFill;
        ctx.fillRect(x, y, width, height);

        // Stroke
        ctx.strokeStyle = isHovered ? highlightStroke : defaultStroke;
        ctx.lineWidth = (isHovered ? 3 : 2) / zoom;
        ctx.strokeRect(x, y, width, height);

        // Halo effect on hover
        if (isHovered) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = highlightStroke;
          ctx.strokeRect(x, y, width, height);
          ctx.shadowBlur = 0;
        }
      }

      ctx.restore();
    };
  }, [
    selectedScreenshotId,
    screenshotCache,
    imagesWithBboxes,
    zoom,
    pan,
    hoveredImageId,
    containerWidth,
  ]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.2, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="flex gap-4 h-full min-h-0">
      <style>{`
        [data-radix-scroll-area-viewport] {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        [data-radix-scroll-area-viewport]::-webkit-scrollbar {
          display: none !important;
        }
      `}</style>
      {/* Panel 1: States List (Cyan) - 16.6% (col-span-2) */}
      <Card className="w-[16.6%] shrink-0 bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 border-b border-brand-primary/20">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-5 h-5 text-brand-primary" />
            <h3 className="text-brand-primary font-mono font-semibold">
              Discovery Archive
            </h3>
          </div>
          <Input
            placeholder="Filter archive..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-surface-canvas border-brand-primary/30 text-white font-mono text-xs focus:border-brand-primary focus:ring-brand-primary/30 placeholder:opacity-30"
          />
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {filteredStates.map((state) => {
              const isSelected = state.id === selectedStateId;
              return (
                <button
                  key={state.id}
                  onClick={() => setSelectedStateId(state.id)}
                  className={`
                      w-full p-4 rounded-lg border text-left transition-all
                      ${
                        isSelected
                          ? "border-brand-primary bg-brand-primary/20 shadow-[0_0_20px_rgba(0,217,255,0.3)]"
                          : "border-brand-primary/10 bg-surface-canvas/50 hover:border-brand-primary/50 hover:bg-brand-primary/5"
                      }
                    `}
                >
                  <div className="font-semibold text-white text-sm mb-2 truncate">
                    {state.name}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted font-mono truncate max-w-[120px]">
                      {state.description || "No metadata"}
                    </span>
                    <Badge className="bg-brand-secondary/20 text-brand-secondary border-brand-secondary/30 text-[10px] scale-90 origin-right">
                      {state.stateImages.length} SIGS
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      {/* Panel 2: Elements Grid (Purple) - 11% (approx 66% of col-span-2) */}
      <Card className="w-[11%] shrink-0 min-w-0 bg-surface-raised/60 border-brand-secondary/30 backdrop-blur-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 border-b border-brand-secondary/20">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-brand-secondary" />
            <h3 className="text-brand-secondary font-mono font-semibold">
              Signatures
            </h3>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {!selectedState ? (
              <div className="h-40 flex items-center justify-center text-text-muted italic text-xs font-mono">
                Awaiting Target...
              </div>
            ) : (
              imagesWithBboxes.map(({ stateImage }) => (
                <StateImageThumbnail
                  key={`${selectedState.id}-${stateImage.id}`}
                  stateImage={stateImage}
                  extractionId={extractionId}
                  annotations={annotations}
                  loadScreenshot={loadScreenshot}
                  onMouseEnter={() => setHoveredImageId(stateImage.id)}
                  onMouseLeave={() => setHoveredImageId(null)}
                  isSelected={hoveredImageId === stateImage.id}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </Card>

      {/* Panel 3: Main Canvas (Green) - Remaining space approx 61.4% */}
      <Card className="flex-1 bg-surface-raised/60 border-brand-success/30 backdrop-blur-sm overflow-hidden flex flex-col relative">
        <div className="p-4 border-b border-brand-success/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Maximize2 className="w-5 h-5 text-brand-success" />
            <h3 className="text-brand-success font-mono font-semibold">
              Visual Feed
            </h3>
          </div>

          {/* Floating HUD Controls */}
          <div className="flex items-center gap-2 bg-surface-canvas/80 rounded-lg p-2 border border-brand-success/30">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleZoomOut}
              className="text-brand-success hover:bg-brand-success/20 h-7 w-7 p-0"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-[10px] font-mono text-brand-success w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleZoomIn}
              className="text-brand-success hover:bg-brand-success/20 h-7 w-7 p-0"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <div className="w-px h-5 bg-brand-success/30 mx-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResetZoom}
              className="text-brand-success hover:bg-brand-success/20 h-7 px-3 text-[10px] font-mono"
            >
              Reset
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResetZoom}
              className="text-brand-success hover:bg-brand-success/20 h-7 w-7 p-0"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-4 bg-surface-canvas/30 flex flex-col items-center"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor:
              zoom > 1 && isDragging
                ? "grabbing"
                : zoom > 1
                  ? "grab"
                  : "default",
          }}
        >
          {loadingScreenshots.has(selectedScreenshotId || "") ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-brand-success" />
              <span className="text-brand-success text-xs font-mono animate-pulse">
                Syncing Feed...
              </span>
            </div>
          ) : selectedScreenshotId &&
            screenshotCache.has(selectedScreenshotId) ? (
            <canvas
              ref={canvasRef}
              className="rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.5)] bg-surface-canvas border border-white/5"
            />
          ) : (
            <div className="text-text-muted font-mono text-xs text-center space-y-2">
              <div>No visual data for current state</div>
              {stateScreenshotIds.length === 0 && (
                <div className="animate-pulse">[ NO SOURCE FOUND ]</div>
              )}
            </div>
          )}

          {/* Label for hovered signature */}
          {hoveredImageId && (
            <div className="absolute bottom-4 left-4 bg-black/80 border border-brand-success/50 rounded px-3 py-1.5 backdrop-blur-sm">
              <div className="text-[10px] text-brand-success font-mono leading-tight whitespace-nowrap">
                LOCK ON:{" "}
                {
                  imagesWithBboxes.find(
                    (i) => i.stateImage.id === hoveredImageId
                  )?.stateImage.name
                }
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Panel 4: Screenshot Thumbnails (Cyan) - 11% (approx 66% of col-span-2) */}
      <Card className="w-[11%] shrink-0 bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 border-b border-brand-primary/20">
          <h3 className="text-brand-primary font-mono font-semibold text-xs">
            Temporal Strip
          </h3>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            {stateScreenshotIds.map((ssId) => (
              <ScreenshotThumbnail
                key={ssId}
                screenshotId={ssId}
                isSelected={ssId === selectedScreenshotId}
                screenshotCache={screenshotCache}
                isLoading={loadingScreenshots.has(ssId)}
                onClick={() => {
                  setSelectedScreenshotId(ssId);
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

// Sub-component: State Image Thumbnail
interface StateImageThumbnailProps {
  stateImage: StateMachineStateImage;
  extractionId?: string;
  annotations: ExtractionAnnotation[];
  loadScreenshot: (screenshotId: string) => Promise<string | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isSelected?: boolean;
}

function StateImageThumbnail({
  stateImage,
  extractionId,
  annotations,
  loadScreenshot,
  onMouseEnter,
  onMouseLeave,
  isSelected,
}: StateImageThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadedRef = useRef(false);

  const bbox = getStateImageBoundingBox(stateImage);

  // Find target screenshot ID
  const targetScreenshotId = useMemo(() => {
    if (stateImage.screenshotId) {
      const found = annotations.find(
        (a) => a.screenshot_id === stateImage.screenshotId
      );
      return found?.screenshot_id;
    }
    return annotations[0]?.screenshot_id;
  }, [stateImage.screenshotId, annotations]);

  // Load cropped thumbnail
  useEffect(() => {
    if (!extractionId || !bbox || !targetScreenshotId) {
      setIsLoading(false);
      return;
    }

    if (loadedRef.current && thumbnailUrl) {
      return;
    }

    let cancelled = false;

    const loadThumbnail = async () => {
      setIsLoading(true);
      const url = await loadScreenshot(targetScreenshotId);
      if (cancelled) return;
      if (url && bbox) {
        const croppedUrl = await cropImage(url, bbox);
        if (cancelled) return;
        setThumbnailUrl(croppedUrl);
        loadedRef.current = true;
      }
      setIsLoading(false);
    };

    loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [extractionId, targetScreenshotId, bbox, loadScreenshot, thumbnailUrl]);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        p-2 rounded-lg border cursor-pointer transition-all w-full max-w-full
        ${
          isSelected
            ? "border-brand-success bg-brand-success/20 shadow-[0_0_15px_rgba(0,255,136,0.2)]"
            : "border-brand-secondary/20 bg-surface-canvas/50 hover:border-brand-secondary/50"
        }
      `}
    >
      <div className="aspect-video bg-surface-canvas rounded border border-brand-secondary/20 mb-2 overflow-hidden flex items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-brand-secondary/50" />
        ) : thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={stateImage.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <ImageIcon className="h-4 w-4 text-brand-secondary/30" />
        )}
      </div>
      <div className="text-[10px] font-semibold text-white truncate">
        {stateImage.name}
      </div>
      <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider">
        {stateImage.extractionCategory || "Static"}
      </div>
    </div>
  );
}

// Sub-component: Screenshot Thumbnail
interface ScreenshotThumbnailProps {
  screenshotId: string;
  isSelected: boolean;
  screenshotCache: Map<string, string>;
  isLoading: boolean;
  onClick: () => void;
}

function ScreenshotThumbnail({
  screenshotId,
  isSelected,
  screenshotCache,
  isLoading,
  onClick,
}: ScreenshotThumbnailProps) {
  const imageUrl = screenshotCache.get(screenshotId);

  return (
    <div
      onClick={onClick}
      className={`
        rounded-lg border cursor-pointer transition-all overflow-hidden relative
        ${
          isSelected
            ? "border-brand-primary shadow-[0_0_15px_rgba(0,217,255,0.3)] ring-1 ring-brand-primary/50"
            : "border-brand-primary/20 hover:border-brand-primary/50"
        }
      `}
    >
      <div className="aspect-video bg-surface-canvas">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-brand-primary/40" />
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={screenshotId}
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
          className={`text-[9px] font-mono truncate ${isSelected ? "text-brand-primary" : "text-text-muted"}`}
        >
          UUID: {screenshotId.slice(-8)}
        </div>
      </div>
    </div>
  );
}

// Helper: Crop image to bounding box
async function cropImage(
  imageUrl: string,
  bbox: BoundingBox
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = bbox.width;
      canvas.height = bbox.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }

      // Ensure bbox is within image bounds
      const x = Math.max(0, Math.min(bbox.x, img.naturalWidth - 1));
      const y = Math.max(0, Math.min(bbox.y, img.naturalHeight - 1));
      const width = Math.min(bbox.width, img.naturalWidth - x);
      const height = Math.min(bbox.height, img.naturalHeight - y);

      ctx.drawImage(img, x, y, width, height, 0, 0, bbox.width, bbox.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
