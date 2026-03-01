/**
 * Individual workflow display components for different view modes.
 *
 * - WorkflowListRow: Detailed row with configurable columns (list view)
 * - WorkflowGridCard: Card with thumbnail and summary (grid view)
 * - WorkflowCompactRow: Minimal single-line row (compact view)
 */

import React from "react";
import {
  MoreVertical,
  Copy,
  Trash2,
  Folder,
  Eye,
  LayoutGrid,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Checkbox } from "../../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { cn } from "../../../lib/utils";
import { WorkflowBadges, ComplexityBadge } from "./EdgePanel";
import {
  formatRelativeTime,
  type ColumnConfig,
  type EnhancedWorkflowItem,
} from "./types";

// ============================================================================
// Shared Props
// ============================================================================

interface WorkflowRowProps {
  item: EnhancedWorkflowItem;
  columns: ColumnConfig[];
  bulkSelectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

interface WorkflowCardProps {
  item: EnhancedWorkflowItem;
  bulkSelectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

// ============================================================================
// Workflow Actions Menu (shared dropdown)
// ============================================================================

function WorkflowActionsMenu({
  onOpen,
  onDuplicate,
  onDelete,
  compact,
}: {
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          className={compact ? "h-6 w-6 p-0" : undefined}
        >
          <MoreVertical className={compact ? "h-3 w-3" : "h-4 w-4"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Eye className="h-4 w-4 mr-2" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
        >
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// Workflow List Row Component
// ============================================================================

export function WorkflowListRow({
  item,
  columns,
  bulkSelectMode,
  selected,
  onToggleSelect,
  onOpen,
  onDuplicate,
  onDelete,
}: WorkflowRowProps) {
  return (
    <div
      className={cn(
        "border rounded-lg p-4 hover:border-primary hover:shadow-sm transition cursor-pointer",
        selected && "border-primary bg-accent"
      )}
      role="button"
      tabIndex={0}
      onClick={bulkSelectMode ? onToggleSelect : onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (bulkSelectMode ? onToggleSelect : onOpen)();
        }
      }}
    >
      <div className="flex items-center gap-4">
        {/* Checkbox */}
        {bulkSelectMode && (
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        )}

        {/* Column Content */}
        <div
          className="flex-1 grid gap-4"
          style={{
            gridTemplateColumns: columns.map((c) => `${c.width}px`).join(" "),
          }}
        >
          {columns.map((col) => {
            switch (col.id) {
              case "name":
                return (
                  <div key={col.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                          {item.workflow.name}
                        </h3>
                        <WorkflowBadges item={item} />
                      </div>
                      {item.workflow.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {item.workflow.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              case "folder":
                return (
                  <div
                    key={col.id}
                    className="flex items-center gap-1 text-sm text-muted-foreground"
                  >
                    <Folder className="h-4 w-4" />
                    <span className="truncate">
                      {item.folderPath?.join(" / ") || "None"}
                    </span>
                  </div>
                );
              case "complexity":
                return (
                  <div key={col.id} className="flex items-center gap-2">
                    <ComplexityBadge
                      rating={item.complexityRating}
                      score={item.complexity}
                    />
                  </div>
                );
              case "testCoverage":
                return (
                  <div key={col.id} className="flex items-center gap-2">
                    {item.testCoverage !== undefined ? (
                      <Badge
                        variant={
                          item.testCoverage > 80 ? "default" : "secondary"
                        }
                      >
                        {item.testCoverage.toFixed(0)}% coverage
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No tests
                      </span>
                    )}
                  </div>
                );
              case "lastRun":
                return (
                  <div key={col.id} className="text-sm text-muted-foreground">
                    {item.lastRun
                      ? formatRelativeTime(new Date(item.lastRun))
                      : "Never"}
                  </div>
                );
              case "successRate":
                return (
                  <div key={col.id} className="flex items-center gap-2">
                    {item.successRate !== undefined ? (
                      <Badge
                        variant={
                          item.successRate > 80 ? "default" : "destructive"
                        }
                      >
                        {item.successRate.toFixed(0)}% success
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No data
                      </span>
                    )}
                  </div>
                );
              case "actions":
                return (
                  <div key={col.id} className="text-sm text-muted-foreground">
                    {item.workflow.actions.length} actions
                  </div>
                );
              case "modified":
                return (
                  <div key={col.id} className="text-sm text-muted-foreground">
                    {item.lastModified
                      ? formatRelativeTime(item.lastModified)
                      : "Unknown"}
                  </div>
                );
              default:
                return null;
            }
          })}
        </div>

        {/* Actions Menu */}
        {!bulkSelectMode && (
          <WorkflowActionsMenu
            onOpen={onOpen}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Workflow Grid Card Component
// ============================================================================

export function WorkflowGridCard({
  item,
  bulkSelectMode,
  selected,
  onToggleSelect,
  onOpen,
  onDuplicate,
  onDelete,
}: WorkflowCardProps) {
  return (
    <div
      className={cn(
        "border rounded-lg p-4 hover:border-primary hover:shadow-md transition cursor-pointer relative",
        selected && "border-primary bg-accent"
      )}
      role="button"
      tabIndex={0}
      onClick={bulkSelectMode ? onToggleSelect : onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (bulkSelectMode ? onToggleSelect : onOpen)();
        }
      }}
    >
      {/* Checkbox */}
      {bulkSelectMode && (
        <div className="absolute top-2 left-2">
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        </div>
      )}

      {/* Icon/Thumbnail */}
      <div className="h-24 bg-accent/50 rounded-md mb-3 flex items-center justify-center">
        <LayoutGrid className="h-12 w-12 text-muted-foreground opacity-20" />
      </div>

      {/* Name */}
      <h3 className="font-semibold truncate mb-2">{item.workflow.name}</h3>

      {/* Description */}
      {item.workflow.description && (
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {item.workflow.description}
        </p>
      )}

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        <WorkflowBadges item={item} />
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{item.workflow.actions.length} actions</span>
        {item.complexity && (
          <ComplexityBadge
            rating={item.complexityRating}
            score={item.complexity}
          />
        )}
      </div>

      {/* Actions Menu */}
      {!bulkSelectMode && (
        <div className="absolute top-2 right-2">
          <WorkflowActionsMenu
            onOpen={onOpen}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Workflow Compact Row Component
// ============================================================================

export function WorkflowCompactRow({
  item,
  bulkSelectMode,
  selected,
  onToggleSelect,
  onOpen,
  onDuplicate,
  onDelete,
}: WorkflowCardProps) {
  return (
    <div
      className={cn(
        "border rounded px-3 py-2 hover:border-primary hover:bg-accent/50 transition cursor-pointer flex items-center gap-3",
        selected && "border-primary bg-accent"
      )}
      role="button"
      tabIndex={0}
      onClick={bulkSelectMode ? onToggleSelect : onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (bulkSelectMode ? onToggleSelect : onOpen)();
        }
      }}
    >
      {bulkSelectMode && (
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
      )}

      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className="font-medium truncate">{item.workflow.name}</span>
        <WorkflowBadges item={item} compact />
        <span className="text-xs text-muted-foreground ml-auto">
          {item.workflow.actions.length} actions
        </span>
        {item.complexity && (
          <ComplexityBadge
            rating={item.complexityRating}
            score={item.complexity}
          />
        )}
      </div>

      {!bulkSelectMode && (
        <WorkflowActionsMenu
          onOpen={onOpen}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          compact
        />
      )}
    </div>
  );
}
