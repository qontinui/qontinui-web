"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { datasetService } from "@/services/dataset-service";
import type { ImageGridProps } from "../dataset-viewer-types";

export function ImageGrid({
  images,
  totalImages,
  selectedImage,
  filters,
  totalPages,
  datasetId,
  onSelectImage,
  onFiltersChange,
  showFilters,
}: ImageGridProps) {
  return (
    <div
      className={`col-span-12 ${showFilters ? "lg:col-span-4" : "lg:col-span-5"} overflow-y-auto`}
    >
      <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
        Images ({totalImages})
      </div>
      <div className="p-4">
        <ScrollArea className="h-[500px]">
          <div className="grid grid-cols-3 gap-2">
            {images.map((image) => (
              <div
                key={image.id}
                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                  selectedImage?.id === image.id
                    ? "border-primary ring-2 ring-primary/50"
                    : "border-transparent hover:border-accent"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectImage(image)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectImage(image);
                  }
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic thumbnail URL from backend */}
                <img
                  src={datasetService.getImageThumbnailUrl(
                    datasetId,
                    image.image_hash
                  )}
                  alt={image.filename}
                  width={200}
                  height={200}
                  className="w-full aspect-square object-cover"
                />
                {image.annotation_count !== undefined &&
                  image.annotation_count > 0 && (
                    <Badge className="absolute top-1 right-1 text-xs">
                      {image.annotation_count}
                    </Badge>
                  )}
                {image.reviewed && (
                  <div className="absolute bottom-1 left-1">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={(filters.page || 1) <= 1}
            onClick={() =>
              onFiltersChange((prev) => ({
                ...prev,
                page: (prev.page || 1) - 1,
              }))
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            data-content-role="body-text"
            data-content-label="page indicator"
            className="text-sm text-muted-foreground"
          >
            Page {filters.page || 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(filters.page || 1) >= totalPages}
            onClick={() =>
              onFiltersChange((prev) => ({
                ...prev,
                page: (prev.page || 1) + 1,
              }))
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
