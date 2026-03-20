/**
 * ThumbnailCard Component
 *
 * Individual thumbnail component for screenshot annotation
 *
 * Features:
 * - Active state highlight
 * - Annotation count badge
 * - Screenshot number badge
 * - Remove button
 * - Unsaved changes indicator
 */

import React from "react";
import { X, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ThumbnailCardProps {
  id?: string;
  url?: string;
  index: number;
  annotationCount: number;
  isActive: boolean;
  hasUnsavedChanges?: boolean;
  onClick: () => void;
  onRemove: () => void;
  fileName?: string;
}

export function ThumbnailCard({
  url,
  index,
  annotationCount,
  isActive,
  hasUnsavedChanges,
  onClick,
  onRemove,
  fileName,
}: ThumbnailCardProps) {
  // Log the URL being used for the thumbnail
  React.useEffect(() => {
    console.log(`[ThumbnailCard] Screenshot ${index} rendering with URL:`, {
      url,
      urlType: url?.startsWith("blob:")
        ? "blob"
        : url?.startsWith("http")
          ? "http"
          : "other",
      fileName,
    });
  }, [url, index, fileName]);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "relative group flex-shrink-0 rounded-lg border-2 transition-all cursor-pointer",
        "hover:shadow-md",
        isActive
          ? "border-primary shadow-lg ring-2 ring-primary/20"
          : "border-border hover:border-primary/50"
      )}
      style={{ width: "120px" }}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
    >
      {/* Screenshot Number Badge */}
      <Badge
        variant={isActive ? "default" : "secondary"}
        className="absolute top-1 left-1 z-10 text-xs"
      >
        {index + 1}
      </Badge>

      {/* Annotation Count Badge */}
      {annotationCount > 0 && (
        <Badge
          variant={isActive ? "default" : "outline"}
          className="absolute top-1 right-1 z-10 text-xs"
        >
          {annotationCount}
        </Badge>
      )}

      {/* Unsaved Changes Indicator */}
      {hasUnsavedChanges && (
        <div className="absolute top-1 right-1 z-20">
          <AlertCircle className="h-4 w-4 text-orange-500 fill-orange-100" />
        </div>
      )}

      {/* Thumbnail Image */}
      <div className="relative w-full aspect-video overflow-hidden rounded-t-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`Screenshot ${index + 1}`}
          className={cn(
            "w-full h-full object-cover transition-transform",
            "group-hover:scale-105"
          )}
          onError={(e) => {
            console.error(
              `[ThumbnailCard] Failed to load image for screenshot ${index}:`,
              {
                url,
                fileName,
                error: e,
              }
            );
          }}
        />
      </div>

      {/* File Name (truncated) */}
      {fileName && (
        <div className="px-2 py-1 bg-muted/50 rounded-b-md">
          <p
            className="text-xs text-muted-foreground truncate"
            title={fileName}
          >
            {fileName}
          </p>
        </div>
      )}

      {/* Remove Button */}
      <Button
        variant="destructive"
        size="sm"
        className={cn(
          "absolute -top-2 -right-2 h-6 w-6 rounded-full p-0 shadow-md",
          "opacity-0 group-hover:opacity-100 transition-opacity"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
