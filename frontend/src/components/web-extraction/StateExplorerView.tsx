/**
 * State Explorer View Component
 *
 * State-centric view of extraction results:
 * 1. States - List of discovered states
 * 2. State Images - Visual signatures for selected state
 * 3. Image Locations - Screenshot with bounding box overlays
 * 4. Screenshots - Available screenshots for the state
 */

"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Image as ImageIcon,
  FileImage,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MapPin,
  Layers,
  Monitor,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";
import { getStateImageBoundingBox } from "./utils/bbox-utils";
import {
  ExplorerPanel,
  ExplorerPanelHeader,
  ExplorerPanelContent,
  ExplorerPanelList,
  ExplorerPanelItem,
  ExplorerPanelThumbnail,
  ExplorerPanelEmptyState,
} from "@/components/qontinui/ExplorerPanel";
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

  // Get ALL screenshot IDs from annotations (not just for selected state)
  const allScreenshotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const annotation of annotations) {
      if (annotation.screenshot_id) {
        ids.add(annotation.screenshot_id);
      }
    }
    return Array.from(ids).sort();
  }, [annotations]);

  // Get screenshot IDs where the selected state appears (for highlighting)
  const stateScreenshotIds = useMemo(() => {
    if (!selectedState) return allScreenshotIds;

    // Check if state has screensFound array (from new image-matching algorithm)
    const screensFound = (
      selectedState as StateMachineState & { screensFound?: string[] }
    ).screensFound;
    if (screensFound && screensFound.length > 0) {
      return screensFound;
    }

    // Fallback: get from stateImages
    const ids = new Set<string>();
    for (const img of selectedState.stateImages) {
      // Check for screensFound on image (new format)
      const imgScreensFound = (
        img as StateMachineStateImage & { screensFound?: string[] }
      ).screensFound;
      if (imgScreensFound) {
        imgScreensFound.forEach((id) => ids.add(id));
      } else if (img.screenshotId) {
        ids.add(img.screenshotId);
      }
    }

    // If still no IDs found, return all
    if (ids.size === 0) {
      return allScreenshotIds;
    }
    return Array.from(ids).sort();
  }, [selectedState, allScreenshotIds]);

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
      // Select first screenshot for this state
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const availableWidth = containerWidth - 32;
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

      // Filter images to only those that appear on this specific screenshot
      // Uses screensFound array from new image-matching algorithm, or falls back to screenshotId
      const imagesOnThisScreenshot = imagesWithBboxes.filter(
        ({ stateImage }) => {
          // Check for screensFound array (new format from image-matching)
          const screensFound = (
            stateImage as StateMachineStateImage & { screensFound?: string[] }
          ).screensFound;
          if (screensFound && screensFound.length > 0) {
            return screensFound.includes(selectedScreenshotId!);
          }
          // Fallback: check screenshotId (source screenshot)
          if (stateImage.screenshotId) {
            return stateImage.screenshotId === selectedScreenshotId;
          }
          // No info - assume it appears on all screenshots (legacy behavior)
          return true;
        }
      );

      // Use theme colors
      const defaultStroke = "#4A90D9";
      const defaultFill = "rgba(74, 144, 217, 0.05)";
      const highlightStroke = "#4DB89D";
      const highlightFill = "rgba(77, 184, 157, 0.25)";

      // Determine which images to draw:
      // - If hovering a specific image, only show that image's box prominently
      // - If not hovering, show all boxes faintly for overview
      const hasHoveredImage =
        hoveredImageId &&
        imagesOnThisScreenshot.some(
          ({ stateImage }) => stateImage.id === hoveredImageId
        );

      for (const { stateImage, bbox } of imagesOnThisScreenshot) {
        const x = bbox.x * scaleX;
        const y = bbox.y * scaleY;
        const width = bbox.width * scaleX;
        const height = bbox.height * scaleY;
        const isHovered = stateImage.id === hoveredImageId;

        // When hovering a specific image, only draw that one
        // When not hovering anything, draw all with faint styling
        if (hasHoveredImage && !isHovered) {
          continue; // Skip non-hovered images when one is being hovered
        }

        ctx.fillStyle = isHovered ? highlightFill : defaultFill;
        ctx.fillRect(x, y, width, height);

        ctx.strokeStyle = isHovered ? highlightStroke : defaultStroke;
        ctx.lineWidth = (isHovered ? 3 : 1) / zoom;
        ctx.strokeRect(x, y, width, height);

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

  const handleCopyImage = useCallback(async () => {
    if (!canvasRef.current) return;

    try {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) {
          toast.error("Failed to create image.");
          return;
        }

        try {
          // Use the Clipboard API to write the blob
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob.type]: blob,
            }),
          ]);
          toast.success("Image copied to clipboard");
        } catch (err) {
          console.error("Clipboard write failed:", err);
          toast.error("Failed to copy to clipboard");
        }
      }, "image/png");
    } catch (err) {
      console.error("Canvas export failed:", err);
      toast.error("Failed to capture image");
    }
  }, []);

  return (
    <div
      className="flex gap-4 min-h-0 flex-1 h-full overflow-hidden"
      id="extraction-results-container"
    >
      {/* Panel 1: States List */}
      <ExplorerPanel
        accent="primary"
        width="w-[16%]"
        className="shrink-0"
        id="extraction-results-states-panel"
      >
        <ExplorerPanelHeader title="States" icon={Layers} accent="primary">
          <Badge
            variant="outline"
            className="ml-auto text-[10px] border-brand-primary/30 text-brand-primary"
          >
            {filteredStates.length}
          </Badge>
        </ExplorerPanelHeader>

        <div className="px-3 pt-3 pb-2 border-b border-brand-primary/10 shrink-0">
          <Input
            placeholder="Filter states..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-surface-canvas border-border-subtle text-white font-mono text-xs h-8 focus:border-brand-primary focus:ring-brand-primary/30 placeholder:text-text-muted/50"
          />
        </div>

        <ExplorerPanelContent scrollable padding="sm">
          <ExplorerPanelList>
            {filteredStates.length === 0 ? (
              <ExplorerPanelEmptyState
                message="No states found"
                icon={Layers}
              />
            ) : (
              filteredStates.map((state) => (
                <ExplorerPanelItem
                  key={state.id}
                  selected={state.id === selectedStateId}
                  accent="primary"
                  onClick={() => setSelectedStateId(state.id)}
                  id={`extraction-results-state-${state.id}`}
                  className="overflow-hidden"
                >
                  <div
                    className="font-semibold text-white text-xs mb-1 truncate w-full"
                    title={state.name}
                  >
                    {state.name}
                  </div>
                  <div className="flex items-center justify-between gap-1 w-full min-w-0">
                    <span
                      className="text-[9px] text-text-muted font-mono truncate flex-1 min-w-0"
                      title={state.description || "No description"}
                    >
                      {state.description || "No description"}
                    </span>
                    <Badge className="bg-brand-secondary/20 text-brand-secondary border-brand-secondary/30 text-[9px] px-1.5 shrink-0">
                      {state.stateImages.length}
                    </Badge>
                  </div>
                </ExplorerPanelItem>
              ))
            )}
          </ExplorerPanelList>
        </ExplorerPanelContent>
      </ExplorerPanel>

      {/* Panel 2: State Images */}
      <ExplorerPanel accent="secondary" width="w-[14%]" className="shrink-0">
        <ExplorerPanelHeader
          title="State Images"
          icon={ImageIcon}
          accent="secondary"
          actions={
            selectedState && (
              <Badge
                variant="outline"
                className="text-[10px] border-brand-secondary/30 text-brand-secondary"
              >
                {imagesWithBboxes.length}
              </Badge>
            )
          }
        />

        <ExplorerPanelContent scrollable padding="sm">
          {!selectedState ? (
            <ExplorerPanelEmptyState
              message="Select a state"
              icon={ImageIcon}
            />
          ) : imagesWithBboxes.length === 0 ? (
            <ExplorerPanelEmptyState
              message="No images found"
              icon={ImageIcon}
            />
          ) : (
            <ExplorerPanelList gap="md">
              {imagesWithBboxes.map(({ stateImage }) => (
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
              ))}
            </ExplorerPanelList>
          )}
        </ExplorerPanelContent>
      </ExplorerPanel>

      {/* Panel 3: Image Locations (Main Canvas) */}
      <ExplorerPanel accent="success" className="flex-1">
        <ExplorerPanelHeader
          title="Image Locations"
          icon={MapPin}
          accent="success"
          actions={
            <div className="flex items-center gap-2 bg-surface-canvas/80 rounded-lg px-2 py-1 border border-brand-success/30">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopyImage}
                title="Copy image to clipboard"
                className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0 mr-1"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <div className="w-px h-4 bg-brand-success/30 mx-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleZoomOut}
                className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[10px] font-mono text-brand-success w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleZoomIn}
                className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <div className="w-px h-4 bg-brand-success/30 mx-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResetZoom}
                className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          }
        />

        <ExplorerPanelContent scrollable={false} padding="none">
          {/* Two-layer scroll structure matching ScrollArea pattern exactly */}
          <div
            data-slot="custom-scroll-root"
            className="absolute inset-0 overflow-hidden"
          >
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              ref={containerRef}
              data-slot="custom-scroll-viewport"
              className="h-full w-full overflow-y-auto overflow-x-hidden p-4 bg-surface-canvas/30 scrollbar-dark"
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
              <div className="flex flex-col items-center w-full">
                {loadingScreenshots.has(selectedScreenshotId || "") ? (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <Loader2 className="h-10 w-10 animate-spin text-brand-success" />
                    <span className="text-brand-success text-xs font-mono animate-pulse">
                      Loading...
                    </span>
                  </div>
                ) : selectedScreenshotId &&
                  screenshotCache.has(selectedScreenshotId) ? (
                  <canvas
                    ref={canvasRef}
                    className="rounded-lg shadow-lg bg-surface-canvas border border-border-subtle"
                  />
                ) : (
                  <ExplorerPanelEmptyState
                    message="No screenshot available"
                    icon={FileImage}
                  />
                )}
              </div>

              {/* Label for hovered image */}
              {hoveredImageId && (
                <div className="absolute bottom-4 left-4 bg-black/80 border border-brand-success/50 rounded px-3 py-1.5 backdrop-blur-sm">
                  <div className="text-[10px] text-brand-success font-mono leading-tight whitespace-nowrap">
                    {
                      imagesWithBboxes.find(
                        (i) => i.stateImage.id === hoveredImageId
                      )?.stateImage.name
                    }
                  </div>
                </div>
              )}
            </div>
          </div>
        </ExplorerPanelContent>
      </ExplorerPanel>

      {/* Panel 4: Screenshots - Only shows screenshots where selected state appears */}
      <ExplorerPanel accent="primary" width="w-[12%]" className="shrink-0">
        <ExplorerPanelHeader
          title="Screenshots"
          icon={Monitor}
          accent="primary"
          actions={
            <Badge
              variant="outline"
              className="text-[10px] border-brand-primary/30 text-brand-primary"
            >
              {stateScreenshotIds.length}
            </Badge>
          }
        />

        <ExplorerPanelContent scrollable padding="sm">
          {stateScreenshotIds.length === 0 ? (
            <ExplorerPanelEmptyState message="No screenshots" icon={Monitor} />
          ) : (
            <ExplorerPanelList gap="md">
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
            </ExplorerPanelList>
          )}
        </ExplorerPanelContent>
      </ExplorerPanel>
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
        p-1.5 rounded border cursor-pointer transition-all w-full max-w-full overflow-hidden
        ${
          isSelected
            ? "border-brand-success bg-brand-success/20 shadow-[0_0_8px_rgba(77,184,157,0.2)]"
            : "border-border-subtle bg-surface-canvas/50 hover:border-brand-secondary/50"
        }
      `}
    >
      <div className="aspect-[4/3] bg-surface-canvas rounded border border-border-subtle mb-1 overflow-hidden flex items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-brand-secondary/50" />
        ) : thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={stateImage.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <ImageIcon className="h-3 w-3 text-brand-secondary/30" />
        )}
      </div>
      <div
        className="text-[9px] font-semibold text-white truncate w-full"
        title={stateImage.name}
      >
        {stateImage.name}
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
    <ExplorerPanelThumbnail
      selected={isSelected}
      accent="primary"
      onClick={onClick}
    >
      <div className="w-full h-full bg-surface-canvas">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-brand-primary/40" />
          </div>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={screenshotId}
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${
              isSelected ? "opacity-100" : "opacity-60 hover:opacity-100"
            }`}
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
          className={`text-[9px] font-mono truncate ${
            isSelected ? "text-brand-primary" : "text-text-muted"
          }`}
        >
          {screenshotId.slice(-8)}
        </div>
      </div>
    </ExplorerPanelThumbnail>
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
