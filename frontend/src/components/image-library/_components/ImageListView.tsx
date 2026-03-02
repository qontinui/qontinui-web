/**
 * ImageListView Component
 *
 * Renders images in a table/list layout with selection,
 * sorting columns, and row-level actions.
 */

"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ImageWithMetadata } from "../types";
import { LazyImage } from "../LazyImage";
import {
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
} from "../utils";

export interface ImageListViewProps {
  images: ImageWithMetadata[];
  selectedImageIds: Set<string>;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onDeleteImage: (id: string) => void;
}

export function ImageListView({
  images,
  selectedImageIds,
  selectedImageId,
  onSelectImage,
  onToggleSelection,
  onDeleteImage,
}: ImageListViewProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-4">
        <table className="w-full">
          <thead className="border-b border-border-subtle">
            <tr className="text-left text-sm text-text-muted">
              <th className="pb-2 w-8"></th>
              <th className="pb-2 w-12"></th>
              <th className="pb-2">Name</th>
              <th className="pb-2">Source</th>
              <th className="pb-2">Size</th>
              <th className="pb-2">Usage</th>
              <th className="pb-2">Uploaded</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {images.map((image) => (
              <tr
                key={image.id}
                className={cn(
                  "border-b border-border-subtle hover:bg-surface-raised cursor-pointer transition-colors",
                  selectedImageId === image.id && "bg-brand-success/10"
                )}
                onClick={() => onSelectImage(image.id)}
              >
                <td className="py-2">
                  <Checkbox
                    checked={selectedImageIds.has(image.id)}
                    onCheckedChange={() => onToggleSelection(image.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="py-2">
                  <div className="w-10 h-10 bg-surface-canvas rounded overflow-hidden">
                    <LazyImage
                      src={getImageUrl(image, "thumb")}
                      alt={image.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </td>
                <td className="py-2 font-medium">{image.name}</td>
                <td className="py-2">
                  <Badge
                    className="text-xs"
                    style={{
                      backgroundColor: getSourceColor(image.source),
                      color: "black",
                    }}
                  >
                    {getSourceLabel(image.source)}
                  </Badge>
                </td>
                <td className="py-2 text-sm text-text-muted">
                  {formatFileSize(image.size)}
                </td>
                <td className="py-2">
                  <Badge
                    variant={image.usageCount > 0 ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {image.usageCount}x
                  </Badge>
                </td>
                <td className="py-2 text-sm text-text-muted">
                  {image.createdAt.toLocaleDateString()}
                </td>
                <td className="py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(image.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  );
}
