/**
 * State Details Panel Component
 *
 * Displays state/element details inline (not in a modal):
 * - Cropped image of the state or element
 * - Position and dimension info
 * - Element list with clickable items
 * - Metadata
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Image as ImageIcon,
  AlertCircle,
  Maximize2,
  Minimize2,
  Component,
  MapPin,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { runnerClient } from "@/lib/runner-client";

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

interface StateAnnotation {
  id: string;
  name: string;
  bbox: BoundingBox;
  state_type: string;
  element_ids: string[];
}

interface StateDetailsPanelProps {
  state: StateAnnotation;
  elements: ElementAnnotation[];
  extractionId: string;
  screenshotId: string;
  viewportWidth: number;
  viewportHeight: number;
}

type ViewMode = "state" | "element";

export function StateDetailsPanel({
  state,
  elements,
  extractionId,
  screenshotId,
  viewportWidth,
  viewportHeight,
}: StateDetailsPanelProps) {
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullImage, setShowFullImage] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("state");
  const [selectedElement, setSelectedElement] =
    useState<ElementAnnotation | null>(null);
  const [elementImageUrl, setElementImageUrl] = useState<string | null>(null);

  const blobUrlRef = useRef<string | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  const cleanupBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stateElements = elements.filter((el) =>
    state.element_ids.includes(el.id)
  );

  const cropElement = useCallback((element: ElementAnnotation) => {
    const img = loadedImageRef.current;
    if (!img) return null;

    const bbox = element.bbox;

    if (
      bbox.x >= img.width ||
      bbox.y >= img.height ||
      bbox.width <= 0 ||
      bbox.height <= 0
    ) {
      return null;
    }

    const visibleBbox = {
      x: Math.max(0, bbox.x),
      y: Math.max(0, bbox.y),
      width: Math.min(bbox.width, img.width - Math.max(0, bbox.x)),
      height: Math.min(bbox.height, img.height - Math.max(0, bbox.y)),
    };

    if (visibleBbox.width <= 0 || visibleBbox.height <= 0) {
      return null;
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
      return canvas.toDataURL("image/png");
    }
    return null;
  }, []);

  const handleElementClick = useCallback(
    (element: ElementAnnotation) => {
      setSelectedElement(element);
      setViewMode("element");
      const croppedUrl = cropElement(element);
      setElementImageUrl(croppedUrl);
    },
    [cropElement]
  );

  const handleBackToState = useCallback(() => {
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
  }, []);

  // Reset when state changes
  useEffect(() => {
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
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

          loadedImageRef.current = img;

          const isOutOfBounds =
            state.bbox.y >= img.height ||
            state.bbox.x >= img.width ||
            state.bbox.y + state.bbox.height <= 0 ||
            state.bbox.x + state.bbox.width <= 0;

          if (isOutOfBounds) {
            setError(
              `State is outside the captured screenshot area. The state is at Y=${state.bbox.y}px but the screenshot is only ${img.height}px tall.`
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
            setError("State region has no visible area in the screenshot");
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

            const croppedUrl = canvas.toDataURL("image/png");
            setCroppedImageUrl(croppedUrl);
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

  const currentBbox =
    viewMode === "element" && selectedElement
      ? selectedElement.bbox
      : state.bbox;
  const currentImageUrl =
    viewMode === "element" ? elementImageUrl : croppedImageUrl;
  const currentTitle =
    viewMode === "element" && selectedElement
      ? selectedElement.name || selectedElement.id
      : state.name;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b shrink-0">
        {viewMode === "element" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleBackToState}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm truncate">{currentTitle}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {viewMode === "element" && selectedElement
            ? selectedElement.element_type
            : state.state_type}
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Image Section */}
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
                onClick={() => setShowFullImage(!showFullImage)}
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

          <Separator />

          {/* Position & Dimensions */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Position & Size
            </h4>
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">X:</span>{" "}
                {currentBbox.x}
              </div>
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">Y:</span>{" "}
                {currentBbox.y}
              </div>
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">W:</span>{" "}
                {currentBbox.width}
              </div>
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">H:</span>{" "}
                {currentBbox.height}
              </div>
            </div>
          </div>

          <Separator />

          {/* Elements */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium flex items-center gap-1.5">
              <Component className="h-3.5 w-3.5" />
              Elements ({stateElements.length})
            </h4>
            {stateElements.length > 0 ? (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {stateElements.map((element) => {
                  const displayName = element.name || element.id;
                  const truncatedName =
                    displayName.length > 25
                      ? `${displayName.substring(0, 25)}...`
                      : displayName;

                  return (
                    <button
                      key={element.id}
                      type="button"
                      onClick={() => handleElementClick(element)}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 transition-colors ${
                        selectedElement?.id === element.id
                          ? "bg-brand-primary/20 border border-brand-primary text-foreground"
                          : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                      }`}
                      title={`${displayName}\nType: ${element.element_type}\n${element.text || ""}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{truncatedName}</span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0 h-4 shrink-0"
                        >
                          {element.element_type}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No elements in this state
              </p>
            )}
          </div>

          {/* Element text if viewing element */}
          {viewMode === "element" && selectedElement?.text && (
            <>
              <Separator />
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Text:</span>
                <p className="text-xs bg-muted rounded px-2 py-1.5 break-words">
                  {selectedElement.text}
                </p>
              </div>
            </>
          )}

          <Separator />

          {/* Metadata */}
          <div className="space-y-1.5 text-xs">
            <h4 className="font-medium">Metadata</h4>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {viewMode === "element" ? "Element ID:" : "State ID:"}
              </span>
              <span
                className="font-mono truncate max-w-[100px]"
                title={
                  viewMode === "element" && selectedElement
                    ? selectedElement.id
                    : state.id
                }
              >
                {(viewMode === "element" && selectedElement
                  ? selectedElement.id
                  : state.id
                ).substring(0, 8)}
                ...
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Viewport:</span>
              <span>
                {viewportWidth}×{viewportHeight}
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
