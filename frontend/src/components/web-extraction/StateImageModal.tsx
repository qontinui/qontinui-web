/**
 * State Image Modal Component
 *
 * Displays a modal with the cropped state image from the extraction screenshot,
 * along with state metadata and clickable element list to view individual elements.
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Ruler,
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

interface StateImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: StateAnnotation;
  elements: ElementAnnotation[];
  extractionId: string;
  screenshotId: string;
  viewportWidth: number;
  viewportHeight: number;
}

type ViewMode = "state" | "element";

export function StateImageModal({
  isOpen,
  onClose,
  state,
  elements,
  extractionId,
  screenshotId,
  viewportWidth,
  viewportHeight,
}: StateImageModalProps) {
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullImage, setShowFullImage] = useState(false);

  // View mode: "state" shows the state region, "element" shows selected element
  const [viewMode, setViewMode] = useState<ViewMode>("state");
  const [selectedElement, setSelectedElement] =
    useState<ElementAnnotation | null>(null);
  const [elementImageUrl, setElementImageUrl] = useState<string | null>(null);

  // Use ref to track blob URL for proper cleanup
  const blobUrlRef = useRef<string | null>(null);
  // Store the loaded image for cropping elements
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  // Cleanup function that revokes the blob URL
  const cleanupBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  // Get elements that belong to this state
  const stateElements = elements.filter((el) =>
    state.element_ids.includes(el.id)
  );

  // Crop an element from the loaded image
  const cropElement = useCallback((element: ElementAnnotation) => {
    const img = loadedImageRef.current;
    if (!img) return null;

    const bbox = element.bbox;

    // Check bounds
    if (
      bbox.x >= img.width ||
      bbox.y >= img.height ||
      bbox.width <= 0 ||
      bbox.height <= 0
    ) {
      return null;
    }

    // Clamp to image bounds
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

  // Handle element click
  const handleElementClick = useCallback(
    (element: ElementAnnotation) => {
      setSelectedElement(element);
      setViewMode("element");

      const croppedUrl = cropElement(element);
      setElementImageUrl(croppedUrl);
    },
    [cropElement]
  );

  // Go back to state view
  const handleBackToState = useCallback(() => {
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
  }, []);

  // Load and crop screenshot when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset state when closing
      cleanupBlobUrl();
      setCroppedImageUrl(null);
      setFullImageUrl(null);
      setError(null);
      setLoading(true);
      setShowFullImage(false);
      setViewMode("state");
      setSelectedElement(null);
      setElementImageUrl(null);
      loadedImageRef.current = null;
      return;
    }

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

        // Cleanup any previous blob URL
        cleanupBlobUrl();

        // Create full image URL
        const fullUrl = URL.createObjectURL(result.blob);
        blobUrlRef.current = fullUrl;
        setFullImageUrl(fullUrl);

        // Load image and crop to state bounding box
        const img = new Image();

        img.onload = () => {
          if (!mounted) return;

          // Store loaded image for element cropping
          loadedImageRef.current = img;

          // Check if state bbox is within the screenshot bounds
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

          // Calculate the visible portion of the state within the screenshot
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

          // Clamp to image bounds
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

          // Create canvas to crop the image
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
    isOpen,
    extractionId,
    screenshotId,
    state.bbox.x,
    state.bbox.y,
    state.bbox.width,
    state.bbox.height,
    cleanupBlobUrl,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupBlobUrl();
    };
  }, [cleanupBlobUrl]);

  // Current display info based on view mode
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {viewMode === "element" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 mr-1"
                onClick={handleBackToState}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <ImageIcon className="h-5 w-5" />
            {currentTitle}
            <Badge variant="outline" className="ml-2">
              {viewMode === "element" && selectedElement
                ? selectedElement.element_type
                : state.state_type}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {viewMode === "element"
              ? "Element region from extraction screenshot"
              : "State region from extraction screenshot"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex gap-4">
          {/* Image Section */}
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
                  <span className="text-xs">
                    Make sure the runner is connected
                  </span>
                </div>
              ) : showFullImage && fullImageUrl ? (
                <div className="relative w-full h-full overflow-auto">
                  <div className="relative inline-block min-w-full">
                    <img
                      src={fullImageUrl}
                      alt="Full screenshot"
                      className="max-w-none"
                      style={{ maxHeight: "500px" }}
                    />
                    {/* Highlight the current region */}
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

          {/* Details Section */}
          <div className="w-64 flex-shrink-0 min-h-0 flex flex-col">
            <ScrollArea className="flex-1">
              <div className="space-y-4 pr-2">
                {/* Position & Dimensions */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Position
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-muted rounded px-2 py-1">
                      <span className="text-muted-foreground">X:</span>{" "}
                      {currentBbox.x}
                    </div>
                    <div className="bg-muted rounded px-2 py-1">
                      <span className="text-muted-foreground">Y:</span>{" "}
                      {currentBbox.y}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Dimensions
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-muted rounded px-2 py-1">
                      <span className="text-muted-foreground">W:</span>{" "}
                      {currentBbox.width}px
                    </div>
                    <div className="bg-muted rounded px-2 py-1">
                      <span className="text-muted-foreground">H:</span>{" "}
                      {currentBbox.height}px
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Elements */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Component className="h-4 w-4" />
                    Elements ({stateElements.length})
                  </h4>
                  {stateElements.length > 0 ? (
                    <div className="space-y-1">
                      {stateElements.map((element) => {
                        // Use name if available, otherwise fall back to id
                        const displayName = element.name || element.id;
                        const truncatedName =
                          displayName.length > 20
                            ? `${displayName.substring(0, 20)}...`
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
                                className="text-[10px] px-1 py-0 h-4"
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

                <Separator />

                {/* Metadata */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Metadata</h4>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {viewMode === "element" ? "Element ID:" : "State ID:"}
                      </span>
                      <span
                        className="font-mono truncate max-w-[120px]"
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
                    {viewMode === "element" && selectedElement?.text && (
                      <div className="mt-2">
                        <span className="text-muted-foreground">Text:</span>
                        <p className="mt-1 bg-muted rounded px-2 py-1 break-words">
                          {selectedElement.text}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
