"use client";

import React from "react";
import {
  Upload,
  Search,
  Filter,
  Grid3x3,
  List,
  Play,
  X,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { ImageViewMode, ImageGridSize, ImageFilter } from "../types";

interface ToolbarProps {
  filteredCount: number;
  selectedCount: number;
  currentFilter: ImageFilter;
  onFilterChange: (filter: ImageFilter) => void;
  viewMode: ImageViewMode;
  onViewModeChange: (mode: ImageViewMode) => void;
  gridSize: ImageGridSize;
  onGridSizeChange: (size: ImageGridSize) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  onUploadClick: () => void;
}

export function Toolbar({
  filteredCount,
  selectedCount,
  currentFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  gridSize,
  onGridSizeChange,
  showFilters,
  onToggleFilters,
  onUploadClick,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-border-subtle">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold">Image Library</h2>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="bg-surface-raised/50 border-border-default"
          >
            {filteredCount} images
          </Badge>
          {selectedCount > 0 && (
            <Badge className="bg-brand-success text-black">
              {selectedCount} selected
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            placeholder="Search images..."
            value={currentFilter.query || ""}
            onChange={(e) =>
              onFilterChange({ ...currentFilter, query: e.target.value })
            }
            className="pl-10 w-64 bg-transparent border-border-default focus:border-brand-success"
          />
          {currentFilter.query && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => onFilterChange({ ...currentFilter, query: "" })}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-1 bg-surface-raised rounded-lg p-1">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="sm"
            onClick={() => onViewModeChange("grid")}
            className={cn(viewMode === "grid" && "bg-brand-success text-black")}
          >
            <Grid3x3 className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => onViewModeChange("list")}
            className={cn(viewMode === "list" && "bg-brand-success text-black")}
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === "slideshow" ? "default" : "ghost"}
            size="sm"
            onClick={() => onViewModeChange("slideshow")}
            className={cn(
              viewMode === "slideshow" && "bg-brand-success text-black"
            )}
          >
            <Play className="w-4 h-4" />
          </Button>
        </div>

        {/* Grid Size Slider */}
        {viewMode === "grid" && (
          <div className="flex items-center gap-2 bg-surface-raised rounded-lg px-3 py-2">
            <Minus className="w-3 h-3 text-text-muted" />
            <Slider
              value={[
                gridSize === "small" ? 0 : gridSize === "medium" ? 50 : 100,
              ]}
              onValueChange={(values) => {
                const value = values[0];
                if (value === undefined) return;
                if (value < 33) onGridSizeChange("small");
                else if (value < 67) onGridSizeChange("medium");
                else onGridSizeChange("large");
              }}
              max={100}
              step={1}
              className="w-24"
            />
            <Plus className="w-3 h-3 text-text-muted" />
          </div>
        )}

        {/* Filters */}
        <Button
          variant={showFilters ? "default" : "outline"}
          size="sm"
          onClick={onToggleFilters}
          className={cn(
            showFilters && "bg-brand-success text-black",
            "border-border-default"
          )}
        >
          <Filter className="w-4 h-4 mr-2" />
          Filters
        </Button>

        {/* Upload */}
        <Button
          onClick={onUploadClick}
          className="bg-brand-success hover:bg-brand-success/80 text-black"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload
        </Button>
      </div>
    </div>
  );
}
