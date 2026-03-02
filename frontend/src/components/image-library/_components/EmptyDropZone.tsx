/**
 * EmptyDropZone Component
 *
 * Displays an empty state with drag-and-drop upload support
 * when no images are present in the library.
 */

"use client";

import React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyDropZoneProps {
  dragActive: boolean;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function EmptyDropZone({
  dragActive,
  onDrag,
  onDrop,
}: EmptyDropZoneProps) {
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
