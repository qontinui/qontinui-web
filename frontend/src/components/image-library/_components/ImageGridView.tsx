/**
 * ImageGridView Component
 *
 * Renders images in a responsive grid layout with selection,
 * hover actions, and drag-and-drop upload support.
 */

"use client";

import React from "react";
import { Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { ImageWithMetadata, ImageGridSize } from "../types";
import { LazyImage } from "../LazyImage";
import {
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
} from "../utils";
import { EmptyDropZone } from "./EmptyDropZone";

export interface ImageGridViewProps {
  images: ImageWithMetadata[];
  gridSize: ImageGridSize;
  selectedImageIds: Set<string>;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onDeleteImage: (id: string) => void;
  onEditMask: (image: ImageAsset) => void;
  dragActive: boolean;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

const GRID_SIZE_CLASSES: Record<ImageGridSize, string> = {
  small: "grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20",
  medium: "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10",
  large: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
};

export function ImageGridView({
  images,
  gridSize,
  selectedImageIds,
  selectedImageId,
  onSelectImage,
  onToggleSelection,
  onDeleteImage,
  onEditMask,
  dragActive,
  onDrag,
  onDrop,
}: ImageGridViewProps) {
  if (images.length === 0) {
    return (
      <EmptyDropZone dragActive={dragActive} onDrag={onDrag} onDrop={onDrop} />
    );
  }

  const gridSizeClass = GRID_SIZE_CLASSES[gridSize] ?? GRID_SIZE_CLASSES.medium;

  return (
    <ScrollArea className="flex-1">
      <div className={cn("grid gap-2 p-4", gridSizeClass)}>
        {images.map((image) => (
          <Card
            key={image.id}
            className={cn(
              "border-border-default bg-surface-raised transition-all group cursor-pointer relative",
              selectedImageId === image.id && "ring-2 ring-brand-success",
              selectedImageIds.has(image.id) && "ring-2 ring-brand-primary"
            )}
            onClick={() => onSelectImage(image.id)}
          >
            <CardContent className="p-2">
              {/* Selection Checkbox */}
              <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Checkbox
                  checked={selectedImageIds.has(image.id)}
                  onCheckedChange={() => onToggleSelection(image.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-black/50 border-border-subtle"
                />
              </div>

              {/* Image Preview */}
              <div className="aspect-square bg-surface-canvas rounded overflow-hidden relative mb-2">
                <LazyImage
                  src={getImageUrl(image, "thumb")}
                  alt={image.name}
                  className="w-full h-full object-contain"
                />

                {/* Hover Actions */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-purple-400 hover:text-purple-300 hover:bg-purple-400/20 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditMask(image);
                    }}
                    title="Edit Mask"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/20 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(image.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Image Info */}
              {gridSize !== "small" && (
                <div className="space-y-1">
                  <h4
                    className="font-medium text-xs truncate"
                    title={image.name}
                  >
                    {image.name}
                  </h4>

                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{formatFileSize(image.size)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <Badge
                      variant={image.usageCount > 0 ? "default" : "secondary"}
                      className={cn(
                        "text-xs px-1 py-0 h-4",
                        image.usageCount > 0
                          ? "bg-brand-success text-black"
                          : "bg-surface-raised text-text-muted"
                      )}
                    >
                      {image.usageCount}x
                    </Badge>
                    <Badge
                      className="text-xs px-1 py-0 h-4"
                      style={{
                        backgroundColor: getSourceColor(image.source),
                        color: "black",
                      }}
                    >
                      {getSourceLabel(image.source)}
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
