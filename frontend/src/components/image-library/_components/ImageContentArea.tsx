"use client";

import React from "react";
import type { ImageAsset } from "@/contexts/automation-context/types";
import { ImageGridView } from "./ImageGridView";
import { ImageListView } from "./ImageListView";
import { ImageDetailsSidebar } from "./ImageDetailsSidebar";
import type { ImageViewMode, ImageGridSize, ImageWithMetadata } from "../types";
import type { ImageUsageDetail } from "../_hooks/useImageUsageDetails";

interface ImageContentAreaProps {
  viewMode: ImageViewMode;
  gridSize: ImageGridSize;
  filteredImages: ImageWithMetadata[];
  selectedImageIds: Set<string>;
  selectedImageId: string | null;
  selectedImage: ImageWithMetadata | null;
  imageUsageDetails: ImageUsageDetail[];
  onSelectImage: (id: string | null) => void;
  onToggleSelection: (id: string) => void;
  onDeleteImage: (id: string) => void;
  onEditMask: (image: ImageAsset) => void;
  dragActive: boolean;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function ImageContentArea({
  viewMode,
  gridSize,
  filteredImages,
  selectedImageIds,
  selectedImageId,
  selectedImage,
  imageUsageDetails,
  onSelectImage,
  onToggleSelection,
  onDeleteImage,
  onEditMask,
  dragActive,
  onDrag,
  onDrop,
}: ImageContentAreaProps) {
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Center - Image Grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {viewMode === "grid" && (
          <ImageGridView
            images={filteredImages}
            gridSize={gridSize}
            selectedImageIds={selectedImageIds}
            selectedImageId={selectedImageId}
            onSelectImage={onSelectImage}
            onToggleSelection={onToggleSelection}
            onDeleteImage={onDeleteImage}
            onEditMask={onEditMask}
            dragActive={dragActive}
            onDrag={onDrag}
            onDrop={onDrop}
          />
        )}

        {viewMode === "list" && (
          <ImageListView
            images={filteredImages}
            selectedImageIds={selectedImageIds}
            selectedImageId={selectedImageId}
            onSelectImage={onSelectImage}
            onToggleSelection={onToggleSelection}
            onDeleteImage={onDeleteImage}
          />
        )}
      </div>

      {/* Right Sidebar - Image Details */}
      {selectedImage && (
        <div className="w-80 border-l border-border-subtle flex flex-col">
          <ImageDetailsSidebar
            image={selectedImage}
            usageDetails={imageUsageDetails}
            onClose={() => onSelectImage(null)}
            onDelete={() => onDeleteImage(selectedImage.id)}
            onEditMask={() => onEditMask(selectedImage)}
          />
        </div>
      )}
    </div>
  );
}
