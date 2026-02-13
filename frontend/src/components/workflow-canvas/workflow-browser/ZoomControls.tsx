/**
 * View mode toggle and column visibility controls for the Workflow Browser.
 *
 * Provides buttons to switch between list/grid/compact view modes
 * and a dropdown to toggle column visibility in list view.
 */

import React from "react";
import {
  Grid,
  List,
  Columns,
  Rows,
  FolderOpen,
  Check,
  Filter as FilterIcon,
} from "lucide-react";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "../../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import type { ViewMode, ColumnConfig } from "./types";

// ============================================================================
// Props
// ============================================================================

interface ZoomControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  columns: ColumnConfig[];
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  showFolderTree: boolean;
  onToggleFolderTree: () => void;
  showAdvancedSearch: boolean;
  onToggleAdvancedSearch: () => void;
  bulkSelectMode: boolean;
  onToggleBulkSelect: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ZoomControls({
  viewMode,
  onViewModeChange,
  columns,
  onColumnVisibilityChange,
  showFolderTree: _showFolderTree,
  onToggleFolderTree,
  showAdvancedSearch: _showAdvancedSearch,
  onToggleAdvancedSearch,
  bulkSelectMode,
  onToggleBulkSelect,
}: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 border rounded-md p-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => onViewModeChange("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>List View</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => onViewModeChange("grid")}
              >
                <Grid className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Grid View</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "compact" ? "default" : "ghost"}
                size="sm"
                onClick={() => onViewModeChange("compact")}
              >
                <Rows className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Compact View</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Column Visibility */}
      {viewMode === "list" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns className="h-4 w-4 mr-2" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {columns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                checked={col.visible}
                onCheckedChange={(checked) =>
                  onColumnVisibilityChange(col.id, checked)
                }
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Folder Tree Toggle */}
      <Button variant="outline" size="sm" onClick={onToggleFolderTree}>
        <FolderOpen className="h-4 w-4 mr-2" />
        Folders
      </Button>

      {/* Advanced Search Toggle */}
      <Button variant="outline" size="sm" onClick={onToggleAdvancedSearch}>
        <FilterIcon className="h-4 w-4 mr-2" />
        Filters
      </Button>

      {/* Bulk Select Toggle */}
      <Button
        variant={bulkSelectMode ? "default" : "outline"}
        size="sm"
        onClick={onToggleBulkSelect}
      >
        <Check className="h-4 w-4 mr-2" />
        Select
      </Button>
    </div>
  );
}
