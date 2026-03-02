"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Search, X } from "lucide-react";
import type { ImageAsset } from "@/contexts/automation-context";
import { formatFileSize } from "../utils";

interface ImageHeaderProps {
  images: ImageAsset[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onUploadClick: () => void;
}

export function ImageHeader({
  images,
  searchQuery,
  setSearchQuery,
  onUploadClick,
}: ImageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-6">
        <h2 className="text-2xl font-bold">Library</h2>

        {images.length > 0 && (
          <div className="flex gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
              <span className="text-xs text-text-muted">Total Images:</span>
              <span className="text-sm font-bold text-brand-success">
                {images.length}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
              <span className="text-xs text-text-muted">Total Usage:</span>
              <span className="text-sm font-bold text-brand-primary">
                {images.reduce((acc, img) => acc + img.usageCount, 0)}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
              <span className="text-xs text-text-muted">Total Size:</span>
              <span className="text-sm font-bold text-brand-secondary">
                {formatFileSize(images.reduce((acc, img) => acc + img.size, 0))}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            placeholder="Search images..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 w-64 bg-transparent border-border-default focus:border-brand-success"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => setSearchQuery("")}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
        <Button
          onClick={onUploadClick}
          className="bg-brand-success hover:bg-brand-success/80 text-black"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload Images
        </Button>
      </div>
    </div>
  );
}
