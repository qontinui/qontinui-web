import React from "react";
import { X } from "lucide-react";
import { Button } from "../../../ui/button";
import { Badge } from "../../../ui/badge";
import { ZoomControls } from "../ZoomControls";
import type { ViewMode, ColumnConfig } from "../types";

interface BrowserHeaderProps {
  workflowCount: number;
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
  onClose: () => void;
}

export function BrowserHeader({
  workflowCount,
  viewMode,
  onViewModeChange,
  columns,
  onColumnVisibilityChange,
  showFolderTree,
  onToggleFolderTree,
  showAdvancedSearch,
  onToggleAdvancedSearch,
  bulkSelectMode,
  onToggleBulkSelect,
  onClose,
}: BrowserHeaderProps) {
  return (
    <div className="p-4 border-b flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold">Workflow Browser</h2>
        <Badge variant="secondary">
          {workflowCount} workflow
          {workflowCount !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <ZoomControls
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          columns={columns}
          onColumnVisibilityChange={onColumnVisibilityChange}
          showFolderTree={showFolderTree}
          onToggleFolderTree={onToggleFolderTree}
          showAdvancedSearch={showAdvancedSearch}
          onToggleAdvancedSearch={onToggleAdvancedSearch}
          bulkSelectMode={bulkSelectMode}
          onToggleBulkSelect={onToggleBulkSelect}
        />

        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
