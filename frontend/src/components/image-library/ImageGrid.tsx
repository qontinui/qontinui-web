/**
 * ImageGrid Component
 *
 * Displays images in a responsive grid layout with selection, hover actions,
 * and drag-and-drop upload support. Also includes the ImageList view and
 * ImageDetailsPanel for the right sidebar.
 */

"use client";

import React from "react";
import {
  Upload,
  Trash2,
  Edit,
  X,
  Download,
  Eye,
  Calendar,
  HardDrive,
  Link2,
  Layers,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { ImageWithMetadata, ImageGridSize } from "./types";
import { LazyImage } from "./LazyImage";
import {
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
} from "./utils";

// ============================================================================
// ImageGrid
// ============================================================================

export interface ImageGridProps {
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

export function ImageGrid({
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
}: ImageGridProps) {
  const getGridSizeClass = () => {
    switch (gridSize) {
      case "small":
        return "grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20";
      case "medium":
        return "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
      case "large":
        return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
      default:
        return "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
    }
  };

  if (images.length === 0) {
    return (
      <div
        className={cn(
          "flex-1 flex items-center justify-center border-2 border-dashed m-4 rounded-lg transition-colors",
          dragActive
            ? "border-brand-success bg-brand-success/10"
            : "border-border-default"
        )}
        onDragEnter={onDrag}
        onDragLeave={onDrag}
        onDragOver={onDrag}
        onDrop={onDrop}
      >
        <div className="text-center">
          <Upload
            className={cn(
              "w-16 h-16 mx-auto mb-4",
              dragActive ? "text-brand-success" : "text-text-muted"
            )}
          />
          <p className="text-lg mb-2">No images found</p>
          <p className="text-sm text-text-muted">
            Drag & drop images here or click Upload to add images
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className={cn("grid gap-2 p-4", getGridSizeClass())}>
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

// ============================================================================
// ImageList
// ============================================================================

export interface ImageListProps {
  images: ImageWithMetadata[];
  selectedImageIds: Set<string>;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onDeleteImage: (id: string) => void;
}

export function ImageList({
  images,
  selectedImageIds,
  selectedImageId,
  onSelectImage,
  onToggleSelection,
  onDeleteImage,
}: ImageListProps) {
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

// ============================================================================
// ImageDetailsPanel
// ============================================================================

export interface ImageDetailsPanelProps {
  image: ImageWithMetadata;
  usageDetails: Array<{
    workflowId: string;
    workflowName: string;
    stateId?: string;
    stateName?: string;
  }>;
  onClose: () => void;
  onDelete: () => void;
  onEditMask: () => void;
}

export function ImageDetailsPanel({
  image,
  usageDetails,
  onClose,
  onDelete,
  onEditMask,
}: ImageDetailsPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <h3 className="font-bold">Image Details</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Preview */}
          <div className="aspect-square bg-surface-canvas rounded-lg overflow-hidden">
            <LazyImage
              src={getImageUrl(image, "original")}
              alt={image.name}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Name */}
          <div>
            <h4 className="text-lg font-bold">{image.name}</h4>
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                Size
              </span>
              <span>{formatFileSize(image.size)}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Uploaded
              </span>
              <span>{image.createdAt.toLocaleDateString()}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted flex items-center gap-2">
                <Package className="w-4 h-4" />
                Source
              </span>
              <Badge
                style={{
                  backgroundColor: getSourceColor(image.source),
                  color: "black",
                }}
              >
                {getSourceLabel(image.source)}
              </Badge>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Usage
              </span>
              <Badge variant={image.usageCount > 0 ? "default" : "secondary"}>
                {image.usageCount}x
              </Badge>
            </div>
          </div>

          <Separator className="bg-border-subtle" />

          {/* Usage Details */}
          {usageDetails.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Used In
              </h5>
              <div className="space-y-1">
                {usageDetails.map((usage, idx) => (
                  <div
                    key={idx}
                    className="text-sm p-2 bg-surface-raised rounded"
                  >
                    {usage.stateName && (
                      <div className="flex items-center gap-2">
                        <Eye className="w-3 h-3 text-text-muted" />
                        <span>State: {usage.stateName}</span>
                      </div>
                    )}
                    {usage.workflowName && (
                      <div className="flex items-center gap-2">
                        <Link2 className="w-3 h-3 text-text-muted" />
                        <span>Workflow: {usage.workflowName}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-border-default"
              onClick={onEditMask}
            >
              <Edit className="w-4 h-4 mr-2" />
              Edit Mask
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full border-border-default"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full border-red-700 text-red-400 hover:bg-red-900/20"
              onClick={onDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
