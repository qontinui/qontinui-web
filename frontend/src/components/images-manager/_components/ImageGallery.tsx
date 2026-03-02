"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Trash2, Search, Edit } from "lucide-react";
import type { ImageAsset } from "@/contexts/automation-context";
import { formatFileSize, getSourceLabel, getSourceColor } from "../utils";

interface ImageGalleryProps {
  filteredImages: ImageAsset[];
  searchQuery: string;
  onEditMask: (image: ImageAsset) => void;
  onDeleteImage: (imageId: string) => void;
}

export function ImageGallery({
  filteredImages,
  searchQuery,
  onEditMask,
  onDeleteImage,
}: ImageGalleryProps) {
  if (filteredImages.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        {searchQuery ? (
          <>
            <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No images found</p>
            <p className="text-sm">Try adjusting your search query</p>
          </>
        ) : (
          <>
            <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No images uploaded</p>
            <p className="text-sm">
              Upload images to use in your automation workflows
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 md:grid-cols-8 lg:grid-cols-12 xl:grid-cols-16 gap-2">
      {filteredImages.map((image) => (
        <Card
          key={image.id}
          className="border-border-default bg-surface-raised hover:border-border-subtle transition-colors group"
        >
          <CardContent className="p-1">
            <div className="space-y-1">
              {/* Image Preview - reduced by 50% */}
              <div className="aspect-square bg-surface-canvas rounded overflow-hidden relative w-20 h-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url || "/placeholder.svg"}
                  alt={image.name}
                  className="w-full h-full object-contain p-0.5"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-purple-400 hover:text-purple-300 hover:bg-purple-400/20 h-6 w-6 p-0"
                    onClick={() => onEditMask(image)}
                    title="Edit Mask"
                  >
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/20 h-6 w-6 p-0"
                    onClick={() => onDeleteImage(image.id)}
                    title="Delete Image"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Image Info - adjusted for smaller size */}
              <div className="space-y-0.5">
                <h4
                  className="font-medium text-[10px] truncate"
                  title={image.name}
                >
                  {image.name}
                </h4>

                <div className="flex items-center justify-between text-[8px] text-text-muted">
                  <span>{formatFileSize(image.size)}</span>
                </div>

                <div className="flex items-center justify-between gap-0.5">
                  <Badge
                    variant={image.usageCount > 0 ? "default" : "secondary"}
                    className={`text-[8px] px-0.5 py-0 h-3 ${
                      image.usageCount > 0
                        ? "bg-brand-success text-black"
                        : "bg-surface-raised text-text-muted"
                    }`}
                  >
                    {image.usageCount}x
                  </Badge>
                  <Badge
                    className="text-[8px] px-0.5 py-0 h-3"
                    style={{
                      backgroundColor: getSourceColor(image.source),
                      color: "black",
                    }}
                  >
                    {getSourceLabel(image.source)}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
