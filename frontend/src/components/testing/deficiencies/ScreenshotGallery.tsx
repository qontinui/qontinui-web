"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Download,
  Maximize2,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface ScreenshotGalleryProps {
  screenshots: string[];
  className?: string;
}

/**
 * ScreenshotGallery - Lightbox for before/after/error screenshots
 *
 * Features:
 * - Grid thumbnail view
 * - Click to open lightbox
 * - Navigation between images (prev/next)
 * - Keyboard navigation (arrow keys, escape)
 * - Zoom in/out
 * - Download individual screenshots
 * - Image index display
 * - Responsive design
 * - Loading states
 */
export function ScreenshotGallery({
  screenshots,
  className,
}: ScreenshotGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const handleOpen = (index: number) => {
    setSelectedIndex(index);
    setZoom(1);
  };

  const handleClose = () => {
    setSelectedIndex(null);
    setZoom(1);
  };

  const handlePrevious = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
      setZoom(1);
    }
  };

  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < screenshots.length - 1) {
      setSelectedIndex(selectedIndex + 1);
      setZoom(1);
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleDownload = async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `screenshot-${index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (selectedIndex === null) return;

    switch (e.key) {
      case "ArrowLeft":
        handlePrevious();
        break;
      case "ArrowRight":
        handleNext();
        break;
      case "Escape":
        handleClose();
        break;
      case "+":
      case "=":
        handleZoomIn();
        break;
      case "-":
        handleZoomOut();
        break;
    }
  };

  // Add keyboard listener
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown as unknown);
      return () => window.removeEventListener("keydown", handleKeyDown as unknown);
    }
    return undefined;
  }, [handleKeyDown]);

  if (screenshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ImageIcon className="h-12 w-12 mb-2 opacity-20" />
        <p className="text-sm">No screenshots available</p>
      </div>
    );
  }

  return (
    <>
      {/* Thumbnail Grid */}
      <div
        className={cn(
          "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4",
          className
        )}
      >
        {screenshots.map((url, index) => (
          <div
            key={index}
            className="relative aspect-video rounded-lg border bg-muted cursor-pointer overflow-hidden group hover:border-primary transition-colors"
            onClick={() => handleOpen(index)}
          >
            <Image
              src={url}
              alt={`Screenshot ${index + 1}`}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <Maximize2 className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 text-xs"
            >
              {index + 1}
            </Badge>
          </div>
        ))}
      </div>

      {/* Lightbox Dialog */}
      {selectedIndex !== null && (
        <Dialog open={selectedIndex !== null} onOpenChange={handleClose}>
          <DialogContent
            className="max-w-[95vw] max-h-[95vh] p-0"
            showCloseButton={false}
          >
            <DialogHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <DialogTitle>
                  Screenshot {selectedIndex + 1} of {screenshots.length}
                </DialogTitle>
                <div className="flex items-center gap-2">
                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1 border rounded-lg p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleZoomOut}
                      disabled={zoom <= 0.5}
                      className="h-8 w-8 p-0"
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
                      disabled={zoom >= 3}
                      className="h-8 w-8 p-0"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Download */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleDownload(
                        screenshots[selectedIndex] || "",
                        selectedIndex
                      )
                    }
                  >
                    <Download className="h-4 w-4" />
                  </Button>

                  {/* Close */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClose}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* Image */}
            <div className="relative flex items-center justify-center bg-muted/30 overflow-auto p-4">
              <div
                className="relative transition-transform duration-200"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center",
                }}
              >
                <Image
                  src={screenshots[selectedIndex] || ""}
                  alt={`Screenshot ${selectedIndex + 1}`}
                  width={1200}
                  height={800}
                  className="max-w-full h-auto rounded-lg"
                  priority
                />
              </div>

              {/* Navigation Arrows */}
              {selectedIndex > 0 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full"
                  onClick={handlePrevious}
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
              )}
              {selectedIndex < screenshots.length - 1 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full"
                  onClick={handleNext}
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              )}
            </div>

            {/* Keyboard Hints */}
            <div className="px-4 pb-4">
              <p className="text-xs text-muted-foreground text-center">
                Use arrow keys to navigate • +/- to zoom • ESC to close
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
