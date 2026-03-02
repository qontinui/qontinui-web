/**
 * ImageDetailsSidebar Component
 *
 * Displays detailed information about a selected image in the right sidebar,
 * including preview, metadata, usage details, and action buttons.
 */

"use client";

import React from "react";
import {
  X,
  Download,
  Eye,
  Calendar,
  HardDrive,
  Link2,
  Layers,
  Package,
  Trash2,
  Edit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { ImageWithMetadata } from "../types";
import { LazyImage } from "../LazyImage";
import {
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
} from "../utils";

export interface ImageDetailsSidebarProps {
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

export function ImageDetailsSidebar({
  image,
  usageDetails,
  onClose,
  onDelete,
  onEditMask,
}: ImageDetailsSidebarProps) {
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
