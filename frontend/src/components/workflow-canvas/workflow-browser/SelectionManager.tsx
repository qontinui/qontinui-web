/**
 * Selection, sorting, grouping, quick filters, and bulk operation controls.
 *
 * Provides the toolbar UI for managing workflow selection state,
 * bulk actions, quick filter buttons, and sort/group dropdowns.
 */

import React from "react";
import { Download, FolderPlus, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import type { WorkflowFolder } from "../../workflow-organization/types";
import {
  QUICK_FILTERS,
  type SortBy,
  type SortOrder,
  type GroupBy,
} from "./types";

// ============================================================================
// Quick Filters Bar
// ============================================================================

interface QuickFiltersBarProps {
  activeQuickFilter: string;
  onQuickFilterChange: (filterId: string) => void;
}

export function QuickFiltersBar({
  activeQuickFilter,
  onQuickFilterChange,
}: QuickFiltersBarProps) {
  return (
    <div className="p-4 border-b">
      <div className="flex items-center gap-2 flex-wrap">
        {QUICK_FILTERS.map((qf) => {
          const Icon = qf.icon;
          return (
            <Button
              key={qf.id}
              variant={activeQuickFilter === qf.id ? "default" : "outline"}
              size="sm"
              onClick={() => onQuickFilterChange(qf.id)}
            >
              <Icon className="h-4 w-4 mr-2" />
              {qf.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Bulk Operations Bar
// ============================================================================

interface BulkOperationsBarProps {
  selectedCount: number;
  folders: WorkflowFolder[];
  onMoveToFolder: (folderId: string | null) => void;
  onExport: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

export function BulkOperationsBar({
  selectedCount,
  folders,
  onMoveToFolder,
  onExport,
  onDelete,
  onClearSelection,
}: BulkOperationsBarProps) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary">{selectedCount} selected</Badge>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FolderPlus className="h-4 w-4 mr-2" />
            Move to Folder
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onMoveToFolder(null)}>
            Remove from Folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {folders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              onClick={() => onMoveToFolder(folder.id)}
            >
              {folder.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={onExport}>
        <Download className="h-4 w-4 mr-2" />
        Export
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 className="h-4 w-4 mr-2" />
        Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={onClearSelection}>
        Clear Selection
      </Button>
    </div>
  );
}

// ============================================================================
// Sort & Group Controls
// ============================================================================

interface SortGroupControlsProps {
  sortBy: SortBy;
  onSortByChange: (value: SortBy) => void;
  sortOrder: SortOrder;
  onSortOrderToggle: () => void;
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
}

export function SortGroupControls({
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderToggle,
  groupBy,
  onGroupByChange,
}: SortGroupControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {/* Group By */}
      <Select
        value={groupBy}
        onValueChange={(value) => onGroupByChange(value as GroupBy)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Group by..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No Grouping</SelectItem>
          <SelectItem value="folder">Folder</SelectItem>
          <SelectItem value="category">Category</SelectItem>
          <SelectItem value="tag">Tag</SelectItem>
          <SelectItem value="complexity">Complexity</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort By */}
      <Select
        value={sortBy}
        onValueChange={(value) => onSortByChange(value as SortBy)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Sort by..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="modified">Modified</SelectItem>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="actions">Actions</SelectItem>
          <SelectItem value="complexity">Complexity</SelectItem>
          <SelectItem value="successRate">Success Rate</SelectItem>
          <SelectItem value="lastRun">Last Run</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort Order */}
      <Button variant="outline" size="sm" onClick={onSortOrderToggle}>
        {sortOrder === "asc" ? "A\u2192Z" : "Z\u2192A"}
      </Button>
    </div>
  );
}

// ============================================================================
// Toolbar (combines bulk ops, sort/group, and select-all)
// ============================================================================

interface ToolbarProps {
  bulkSelectMode: boolean;
  selectedCount: number;
  totalCount: number;
  folders: WorkflowFolder[];
  sortBy: SortBy;
  onSortByChange: (value: SortBy) => void;
  sortOrder: SortOrder;
  onSortOrderToggle: () => void;
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
  onMoveToFolder: (folderId: string | null) => void;
  onExport: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  onToggleSelectAll: () => void;
}

export function Toolbar({
  bulkSelectMode,
  selectedCount,
  totalCount,
  folders,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderToggle,
  groupBy,
  onGroupByChange,
  onMoveToFolder,
  onExport,
  onBulkDelete,
  onClearSelection,
  onToggleSelectAll,
}: ToolbarProps) {
  return (
    <div className="px-4 py-2 border-b flex items-center justify-between gap-4">
      {/* Bulk Operations */}
      {bulkSelectMode && selectedCount > 0 && (
        <BulkOperationsBar
          selectedCount={selectedCount}
          folders={folders}
          onMoveToFolder={onMoveToFolder}
          onExport={onExport}
          onDelete={onBulkDelete}
          onClearSelection={onClearSelection}
        />
      )}

      {!bulkSelectMode && (
        <SortGroupControls
          sortBy={sortBy}
          onSortByChange={onSortByChange}
          sortOrder={sortOrder}
          onSortOrderToggle={onSortOrderToggle}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
        />
      )}

      {bulkSelectMode && (
        <Button variant="outline" size="sm" onClick={onToggleSelectAll}>
          {selectedCount === totalCount ? "Deselect All" : "Select All"}
        </Button>
      )}
    </div>
  );
}
