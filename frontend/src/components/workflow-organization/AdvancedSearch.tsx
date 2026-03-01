/**
 * Advanced Search Component
 *
 * Comprehensive search and filter component for workflows with:
 * - Text search (name, description, tags)
 * - Multiple filter criteria
 * - Save/load filter presets
 * - Real-time filtering with debounce
 * - Export search results
 */

import React from "react";
import { Search, Zap, Calendar, FileCheck, BookOpen } from "lucide-react";
import { Workflow } from "../../lib/action-schema/action-types";
import {
  WorkflowFolder,
  SearchFilter,
  SavedFilter,
  WorkflowExecutionStats,
} from "./types";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../../lib/utils";

import { useAdvancedSearchState } from "./_hooks/useAdvancedSearchState";
import { SearchHeader } from "./_components/SearchHeader";
import { FolderFilterPanel } from "./_components/FolderFilterPanel";
import { TagFilterPanel } from "./_components/TagFilterPanel";
import { ComplexityFilterPanel } from "./_components/ComplexityFilterPanel";
import { ExecutionHistoryPanel } from "./_components/ExecutionHistoryPanel";
import { SaveFilterDialog } from "./_components/SaveFilterDialog";

// ============================================================================
// Types
// ============================================================================

export interface AdvancedSearchProps {
  workflows: Workflow[];
  folders: WorkflowFolder[];
  onSearch: (results: Workflow[], filter: SearchFilter) => void;
  onSaveFilter: (name: string, filter: SearchFilter) => void;
  savedFilters?: SavedFilter[];
  /** Execution statistics for workflows (keyed by workflow ID) */
  executionStats?: Map<string, WorkflowExecutionStats>;
  className?: string;
}

// ============================================================================
// Main Component
// ============================================================================

const DEFAULT_SAVED_FILTERS: SavedFilter[] = [];

export function AdvancedSearch({
  workflows,
  folders,
  onSearch,
  onSaveFilter,
  savedFilters = DEFAULT_SAVED_FILTERS,
  executionStats,
  className,
}: AdvancedSearchProps) {
  const state = useAdvancedSearchState({
    workflows,
    onSearch,
    onSaveFilter,
    executionStats,
  });

  return (
    <div className={cn("border rounded-lg bg-card", className)}>
      {/* Header */}
      <SearchHeader
        isFilterActive={state.isFilterActive}
        filteredCount={state.filteredWorkflows.length}
        isExpanded={state.isExpanded}
        setIsExpanded={state.setIsExpanded}
        onClearAll={state.handleClearAll}
        onSaveFilter={() => state.setShowSaveDialog(true)}
        onExportResults={state.handleExportResults}
      />

      {/* Filter Panel */}
      {state.isExpanded && (
        <ScrollArea className="max-h-[600px]">
          <div className="p-4 space-y-4">
            {/* Text Search */}
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, description, or tags..."
                  value={state.textQuery}
                  onChange={(e) => state.setTextQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <Separator />

            {/* Saved Filters */}
            {savedFilters.length > 0 && (
              <>
                <div className="space-y-2">
                  <Label>Saved Filters</Label>
                  <Select
                    onValueChange={(id) => {
                      const savedFilter = savedFilters.find((f) => f.id === id);
                      if (savedFilter) state.handleLoadFilter(savedFilter);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Load a saved filter..." />
                    </SelectTrigger>
                    <SelectContent>
                      {savedFilters.map((sf) => (
                        <SelectItem key={sf.id} value={sf.id}>
                          {sf.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
              </>
            )}

            {/* Folder Filter */}
            <FolderFilterPanel
              folders={folders}
              selectedFolderIds={state.selectedFolderIds}
              setSelectedFolderIds={state.setSelectedFolderIds}
            />

            <Separator />

            {/* Tag Filter */}
            <TagFilterPanel
              availableTags={state.availableTags}
              selectedTags={state.selectedTags}
              setSelectedTags={state.setSelectedTags}
              tagOperator={state.filter.tagOperator || "OR"}
              onTagOperatorChange={(op) =>
                state.setFilter({
                  ...state.filter,
                  tagOperator: op as "AND" | "OR",
                })
              }
            />

            <Separator />

            {/* Date Range Filters */}
            <div className="grid grid-cols-2 gap-4">
              {/* Created Date */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Label>Created</Label>
                </div>
                <div className="space-y-1">
                  <Input
                    type="date"
                    placeholder="From"
                    onChange={(e) => {
                      const date = e.target.value
                        ? new Date(e.target.value)
                        : undefined;
                      state.setFilter({
                        ...state.filter,
                        createdDateRange: {
                          ...state.filter.createdDateRange,
                          from: date,
                        },
                      });
                    }}
                  />
                  <Input
                    type="date"
                    placeholder="To"
                    onChange={(e) => {
                      const date = e.target.value
                        ? new Date(e.target.value)
                        : undefined;
                      state.setFilter({
                        ...state.filter,
                        createdDateRange: {
                          ...state.filter.createdDateRange,
                          to: date,
                        },
                      });
                    }}
                  />
                </div>
              </div>

              {/* Modified Date */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Label>Modified</Label>
                </div>
                <div className="space-y-1">
                  <Input
                    type="date"
                    placeholder="From"
                    onChange={(e) => {
                      const date = e.target.value
                        ? new Date(e.target.value)
                        : undefined;
                      state.setFilter({
                        ...state.filter,
                        modifiedDateRange: {
                          ...state.filter.modifiedDateRange,
                          from: date,
                        },
                      });
                    }}
                  />
                  <Input
                    type="date"
                    placeholder="To"
                    onChange={(e) => {
                      const date = e.target.value
                        ? new Date(e.target.value)
                        : undefined;
                      state.setFilter({
                        ...state.filter,
                        modifiedDateRange: {
                          ...state.filter.modifiedDateRange,
                          to: date,
                        },
                      });
                    }}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Action Types */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <Label>Action Types</Label>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                {state.availableActionTypes.map((type) => (
                  <div
                    key={type}
                    className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={state.selectedActionTypes.includes(type)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          state.setSelectedActionTypes([
                            ...state.selectedActionTypes,
                            type,
                          ]);
                        } else {
                          state.setSelectedActionTypes(
                            state.selectedActionTypes.filter((t) => t !== type)
                          );
                        }
                      }}
                    />
                    <span className="text-sm font-mono text-xs">{type}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Complexity Level */}
            <ComplexityFilterPanel
              selectedComplexity={state.selectedComplexity}
              setSelectedComplexity={state.setSelectedComplexity}
            />

            <Separator />

            {/* Category */}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={state.filter.category || ""}
                onValueChange={(value) =>
                  state.setFilter({
                    ...state.filter,
                    category: value || undefined,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All categories</SelectItem>
                  {state.availableCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Boolean Filters */}
            <div className="grid grid-cols-2 gap-4">
              {/* Has Tests */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-muted-foreground" />
                  <Label>Has Tests</Label>
                </div>
                <Select
                  value={
                    state.filter.hasTests === null ||
                    state.filter.hasTests === undefined
                      ? "all"
                      : state.filter.hasTests
                        ? "yes"
                        : "no"
                  }
                  onValueChange={(value) => {
                    state.setFilter({
                      ...state.filter,
                      hasTests: value === "all" ? null : value === "yes",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Has Documentation */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <Label>Has Docs</Label>
                </div>
                <Select
                  value={
                    state.filter.hasDocumentation === null ||
                    state.filter.hasDocumentation === undefined
                      ? "all"
                      : state.filter.hasDocumentation
                        ? "yes"
                        : "no"
                  }
                  onValueChange={(value) => {
                    state.setFilter({
                      ...state.filter,
                      hasDocumentation:
                        value === "all" ? null : value === "yes",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Execution History Filters */}
            <ExecutionHistoryPanel
              filter={state.filter}
              setFilter={state.setFilter}
              minSuccessRate={state.minSuccessRate}
              setMinSuccessRate={state.setMinSuccessRate}
              minRunCount={state.minRunCount}
              setMinRunCount={state.setMinRunCount}
              executionStats={executionStats}
            />
          </div>
        </ScrollArea>
      )}

      {/* Save Filter Dialog */}
      <SaveFilterDialog
        open={state.showSaveDialog}
        onOpenChange={state.setShowSaveDialog}
        filterName={state.filterName}
        setFilterName={state.setFilterName}
        onSave={state.handleSaveFilter}
      />
    </div>
  );
}
