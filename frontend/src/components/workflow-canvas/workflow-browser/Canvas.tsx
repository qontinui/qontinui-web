/**
 * Workflow display canvas -- the scrollable area that renders workflows
 * in list, grid, or compact view mode, with grouping and empty/loading states.
 */

import React from "react";
import { LayoutGrid } from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { ScrollArea } from "../../ui/scroll-area";
import {
  WorkflowListRow,
  WorkflowGridCard,
  WorkflowCompactRow,
} from "./NodePanel";
import type {
  EnhancedWorkflowItem,
  ColumnConfig,
  ViewMode,
  GroupBy,
  WorkflowGroup,
} from "./types";

// ============================================================================
// Props
// ============================================================================

interface CanvasProps {
  loading: boolean;
  groupedWorkflows: WorkflowGroup[];
  sortedWorkflowCount: number;
  viewMode: ViewMode;
  groupBy: GroupBy;
  visibleColumns: ColumnConfig[];
  bulkSelectMode: boolean;
  selectedWorkflowIds: Set<string>;
  selectedFolderId: string | null;
  onToggleSelectWorkflow: (workflowId: string) => void;
  onOpenWorkflow: (item: EnhancedWorkflowItem) => void;
  onDuplicateWorkflow: (item: EnhancedWorkflowItem) => void;
  onDeleteWorkflow: (item: EnhancedWorkflowItem) => void;
  onClearFilters: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function Canvas({
  loading,
  groupedWorkflows,
  sortedWorkflowCount,
  viewMode,
  groupBy,
  visibleColumns,
  bulkSelectMode,
  selectedWorkflowIds,
  selectedFolderId,
  onToggleSelectWorkflow,
  onOpenWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onClearFilters,
}: CanvasProps) {
  const toggleSelect = (item: EnhancedWorkflowItem) => {
    onToggleSelectWorkflow(item.workflow.id);
  };

  return (
    <ScrollArea className="flex-1">
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading workflows...</p>
          </div>
        </div>
      ) : sortedWorkflowCount === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <LayoutGrid className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
            <h3 className="text-lg font-semibold mb-2">No workflows found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {selectedFolderId
                ? "This folder is empty. Try selecting a different folder or adjusting your filters."
                : "Try adjusting your search filters or create your first workflow to get started."}
            </p>
            {!selectedFolderId && (
              <Button onClick={onClearFilters}>Clear Filters</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4">
          {groupedWorkflows.map((group) => (
            <div key={group.key} className="mb-6">
              {groupBy !== "none" && (
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {group.label}
                    <Badge variant="secondary" className="ml-2">
                      {group.items.length}
                    </Badge>
                  </h3>
                </div>
              )}

              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <WorkflowGridCard
                      key={item.key}
                      item={item}
                      bulkSelectMode={bulkSelectMode}
                      selected={selectedWorkflowIds.has(item.workflow.id)}
                      onToggleSelect={() => toggleSelect(item)}
                      onOpen={() => onOpenWorkflow(item)}
                      onDuplicate={() => onDuplicateWorkflow(item)}
                      onDelete={() => onDeleteWorkflow(item)}
                    />
                  ))}
                </div>
              ) : viewMode === "compact" ? (
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <WorkflowCompactRow
                      key={item.key}
                      item={item}
                      bulkSelectMode={bulkSelectMode}
                      selected={selectedWorkflowIds.has(item.workflow.id)}
                      onToggleSelect={() => toggleSelect(item)}
                      onOpen={() => onOpenWorkflow(item)}
                      onDuplicate={() => onDuplicateWorkflow(item)}
                      onDelete={() => onDeleteWorkflow(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <WorkflowListRow
                      key={item.key}
                      item={item}
                      columns={visibleColumns}
                      bulkSelectMode={bulkSelectMode}
                      selected={selectedWorkflowIds.has(item.workflow.id)}
                      onToggleSelect={() => toggleSelect(item)}
                      onOpen={() => onOpenWorkflow(item)}
                      onDuplicate={() => onDuplicateWorkflow(item)}
                      onDelete={() => onDeleteWorkflow(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </ScrollArea>
  );
}
