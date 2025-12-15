/**
 * ScreenshotThumbnailStrip Component
 *
 * Horizontal scrollable thumbnail strip for managing multiple screenshots
 *
 * Features:
 * - Horizontal scrollable layout
 * - Shows all screenshots with indicators
 * - Click to switch screenshots
 * - Add screenshot button
 * - Current screenshot indicator
 */

import React, { useRef } from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThumbnailCard } from "./ThumbnailCard";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export interface ScreenshotData {
  id?: string;
  file?: File;
  url?: string; // Blob URL for display
  permanentUrl?: string; // Permanent URL from backend (for saving)
  dimensions?: { width: number; height: number };
  annotations?: unknown[];
  hasUnsavedChanges?: boolean;
}

export interface ScreenshotThumbnailStripProps {
  screenshots: ScreenshotData[];
  currentIndex: number;
  onScreenshotSelect: (index: number) => void;
  onScreenshotRemove: (index: number) => void;
  onAddScreenshot: () => void;
  className?: string;
}

export function ScreenshotThumbnailStrip({
  screenshots,
  currentIndex,
  onScreenshotSelect,
  onScreenshotRemove,
  onAddScreenshot,
  className,
}: ScreenshotThumbnailStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 150;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (screenshots.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Screenshots</h3>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1} of {screenshots.length}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onAddScreenshot}
          className="h-8"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {/* Thumbnail Strip */}
      <div className="relative group">
        {/* Left Scroll Button */}
        {screenshots.length > 3 && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 rounded-full shadow-md",
              "opacity-0 group-hover:opacity-100 transition-opacity"
            )}
            onClick={() => handleScroll("left")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Scrollable Container */}
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-2" ref={scrollRef}>
            {screenshots.map((screenshot, index) => (
              <ThumbnailCard
                key={screenshot.id}
                id={screenshot.id}
                url={screenshot.url}
                index={index}
                annotationCount={screenshot.annotations?.length ?? 0}
                isActive={index === currentIndex}
                hasUnsavedChanges={screenshot.hasUnsavedChanges}
                onClick={() => onScreenshotSelect(index)}
                onRemove={() => onScreenshotRemove(index)}
                fileName={screenshot.file?.name ?? ""}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* Right Scroll Button */}
        {screenshots.length > 3 && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 rounded-full shadow-md",
              "opacity-0 group-hover:opacity-100 transition-opacity"
            )}
            onClick={() => handleScroll("right")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
