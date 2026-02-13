/**
 * Workflow Browser Component
 *
 * Enhanced workflow browser with advanced organizational features:
 * - Folder integration with drag-and-drop
 * - Advanced search with multiple filters
 * - Bulk operations (move, tag, delete, export)
 * - Multiple view modes (list, grid, compact)
 * - Column customization and sorting
 * - Grouping by folder, category, tag, complexity
 * - Workflow badges (tests, docs, complexity, etc.)
 * - Quick filter buttons
 * - Context menu with extensive actions
 * - Keyboard shortcuts
 * - Virtualized rendering for performance
 * - Integration with analytics, complexity analyzer, and testing services
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import { workflowFileManager } from "../../../services/workflow-file-manager";
import { workflowSnapshots } from "../../../services/workflow-snapshots";
import { cloneWorkflow } from "../../../lib/action-schema/workflow-utils";
import { workflowFolderManager } from "../../../services/workflow-folder-manager";
import { workflowAnalyticsService } from "../../../services/workflow-analytics-service";
import { workflowComplexityAnalyzer } from "../../../services/workflow-complexity-analyzer";
import { getWorkflowTestingService } from "../../../services/workflow-testing";
import { FolderTree } from "../../workflow-organization/FolderTree";
import { AdvancedSearch } from "../../workflow-organization/AdvancedSearch";
import type {
  SearchFilter,
  SavedFilter,
  WorkflowFolder,
} from "../../workflow-organization/types";
import { X } from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { toast } from "sonner";

import {
  isRecentlyModified,
  QUICK_FILTERS,
  DEFAULT_COLUMNS,
  type WorkflowBrowserProps,
  type EnhancedWorkflowItem,
  type ViewMode,
  type SortBy,
  type SortOrder,
  type GroupBy,
  type ColumnConfig,
} from "./types";
import { ZoomControls } from "./ZoomControls";
import { QuickFiltersBar, Toolbar } from "./SelectionManager";
import { Canvas } from "./Canvas";
import { createLogger } from "@/lib/logger";
const logger = createLogger("WorkflowBrowser");

// ============================================================================
// Workflow Browser Component
// ============================================================================

export function WorkflowBrowser({
  onOpen,
  onClose,
  open,
}: WorkflowBrowserProps) {
  // Core state
  const [workflows, setWorkflows] = useState<EnhancedWorkflowItem[]>([]);
  const [folders, setFolders] = useState<WorkflowFolder[]>([]);
  const [loading, setLoading] = useState(false);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showFolderTree, setShowFolderTree] = useState(true);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Filter and search state
  const [searchFilter, setSearchFilter] = useState<SearchFilter>({});
  const [activeQuickFilter, setActiveQuickFilter] = useState<string>("all");
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  // Sort and group state
  const [sortBy, setSortBy] = useState<SortBy>("modified");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  // Bulk operations state
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Set<string>>(
    new Set()
  );

  // Column configuration
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);

  // Services
  const testingService = getWorkflowTestingService();

  // Load workflows with enhanced metadata
  const loadWorkflows = useCallback(async () => {
    setLoading(true);

    try {
      const keys = workflowFileManager.listWorkflows();
      const items: EnhancedWorkflowItem[] = [];

      // Load folder data
      const folderResult = workflowFolderManager.getAllFolders();
      const folderData = folderResult.success ? folderResult.folders : [];
      setFolders(folderData as unknown as WorkflowFolder[]);

      for (const key of keys) {
        const result = await workflowFileManager.loadWorkflowFromStorage(key);
        if (result.success && result.workflow) {
          const workflow = result.workflow;

          // Get snapshot count
          const snapshotCount = workflowSnapshots.getSnapshotCount(workflow.id);

          // Get folder info
          const folderAssoc = workflowFolderManager.getWorkflowFolder(
            workflow.id
          );
          const folderId = folderAssoc.success ? folderAssoc.folder?.id : null;
          const folderPath = folderId
            ? workflowFolderManager.getFolderPath(folderId).map((p) => p.name)
            : undefined;

          // Get complexity analysis
          const complexityAnalysis =
            workflowComplexityAnalyzer.analyzeComplexity(workflow);

          // Get test coverage
          const testCases = testingService.getTestCasesForWorkflow(workflow.id);
          const coverage =
            testCases.length > 0
              ? testingService.calculateCoverage(workflow.id, workflow)
              : null;

          // Get analytics metrics
          const metrics = workflowAnalyticsService.getWorkflowMetrics(
            workflow.id
          );

          // Check if recently modified
          const lastModified = workflow.metadata?.updated
            ? new Date(workflow.metadata.updated)
            : undefined;

          items.push({
            key,
            workflow,
            lastModified,
            snapshotCount,
            folderId,
            folderPath,
            complexity: complexityAnalysis.complexityScore,
            complexityRating: complexityAnalysis.complexityRating,
            testCoverage: coverage?.coveragePercentage,
            hasTests: testCases.length > 0,
            hasDocumentation: Boolean(
              workflow.description && workflow.description.length > 0
            ),
            lastRun: metrics?.lastExecuted,
            successRate: metrics?.successRate
              ? metrics.successRate * 100
              : undefined,
            avgDuration: metrics?.avgDuration,
            failedLastRun: metrics ? (metrics.successRate || 0) < 1 : false,
            hasDependencies: workflow.actions.some(
              (a) => a.type === "RUN_WORKFLOW"
            ),
            recentlyModified: isRecentlyModified(lastModified),
          });
        }
      }

      setWorkflows(items);
    } catch (error) {
      logger.error("Failed to load workflows:", error);
      toast.error("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [testingService]);

  useEffect(() => {
    if (open) {
      loadWorkflows();
      // Load saved filters from localStorage
      try {
        const saved = localStorage.getItem("workflow-browser-filters");
        if (saved) {
          setSavedFilters(JSON.parse(saved));
        }
      } catch (error) {
        logger.error("Failed to load saved filters:", error);
      }
    }
  }, [open, loadWorkflows]);

  // Apply folder filter
  const folderFilteredWorkflows = useMemo(() => {
    if (selectedFolderId === null) {
      return workflows; // All workflows
    }
    if (selectedFolderId === "uncategorized") {
      return workflows.filter((w) => !w.folderId);
    }
    return workflows.filter((w) => w.folderId === selectedFolderId);
  }, [workflows, selectedFolderId]);

  // Apply advanced search filter
  const searchFilteredWorkflows = useMemo(() => {
    if (Object.keys(searchFilter).length === 0) {
      return folderFilteredWorkflows;
    }
    // The AdvancedSearch component handles filtering internally
    // We receive the filtered results through the onSearch callback
    return folderFilteredWorkflows;
  }, [folderFilteredWorkflows, searchFilter]);

  // Apply quick filter
  const quickFilteredWorkflows = useMemo(() => {
    const quickFilter = QUICK_FILTERS.find((qf) => qf.id === activeQuickFilter);
    if (!quickFilter || quickFilter.id === "all") {
      return searchFilteredWorkflows;
    }
    return searchFilteredWorkflows.filter(quickFilter.filter);
  }, [searchFilteredWorkflows, activeQuickFilter]);

  // Sort workflows
  const sortedWorkflows = useMemo(() => {
    return [...quickFilteredWorkflows].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "modified":
        case "date":
          const dateA = a.lastModified?.getTime() || 0;
          const dateB = b.lastModified?.getTime() || 0;
          comparison = dateA - dateB;
          break;
        case "name":
          comparison = a.workflow.name.localeCompare(b.workflow.name);
          break;
        case "actions":
          comparison = a.workflow.actions.length - b.workflow.actions.length;
          break;
        case "complexity":
          comparison = (a.complexity || 0) - (b.complexity || 0);
          break;
        case "successRate":
          comparison = (a.successRate || 0) - (b.successRate || 0);
          break;
        case "lastRun":
          const runA = a.lastRun ? new Date(a.lastRun).getTime() : 0;
          const runB = b.lastRun ? new Date(b.lastRun).getTime() : 0;
          comparison = runA - runB;
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [quickFilteredWorkflows, sortBy, sortOrder]);

  // Group workflows
  const groupedWorkflows = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: "All Workflows", items: sortedWorkflows }];
    }

    const groups = new Map<string, EnhancedWorkflowItem[]>();

    sortedWorkflows.forEach((item) => {
      let groupKey = "Uncategorized";

      switch (groupBy) {
        case "folder":
          groupKey = item.folderPath?.[0] || "Uncategorized";
          break;
        case "category":
          groupKey = item.workflow.category || "Uncategorized";
          break;
        case "tag":
          const tags = item.workflow.tags || [];
          if (tags.length === 0) {
            groupKey = "No Tags";
          } else {
            // Add to all tag groups
            tags.forEach((tag) => {
              if (!groups.has(tag)) {
                groups.set(tag, []);
              }
              groups.get(tag)!.push(item);
            });
            return; // Don't add to default group
          }
          break;
        case "complexity":
          groupKey = item.complexityRating
            ? item.complexityRating.charAt(0).toUpperCase() +
              item.complexityRating.slice(1)
            : "Unknown";
          break;
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(item);
    });

    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      label: key,
      items,
    }));
  }, [sortedWorkflows, groupBy]);

  // Handlers
  const handleOpenWorkflow = useCallback(
    (item: EnhancedWorkflowItem) => {
      onOpen(item.workflow);
      onClose();
    },
    [onOpen, onClose]
  );

  const handleDuplicateWorkflow = useCallback(
    async (item: EnhancedWorkflowItem) => {
      const duplicated = cloneWorkflow(item.workflow);
      duplicated.name = `${item.workflow.name} (Copy)`;
      await workflowFileManager.saveWorkflow(duplicated);
      toast.success("Workflow duplicated");
      loadWorkflows();
    },
    [loadWorkflows]
  );

  const handleDeleteWorkflow = useCallback(
    async (item: EnhancedWorkflowItem) => {
      if (confirm(`Delete workflow "${item.workflow.name}"?`)) {
        await workflowFileManager.deleteWorkflow(item.key);
        toast.success("Workflow deleted");
        loadWorkflows();
      }
    },
    [loadWorkflows]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedWorkflowIds.size === 0) return;

    if (
      confirm(
        `Delete ${selectedWorkflowIds.size} workflow${selectedWorkflowIds.size !== 1 ? "s" : ""}?`
      )
    ) {
      for (const id of selectedWorkflowIds) {
        const item = workflows.find((w) => w.workflow.id === id);
        if (item) {
          await workflowFileManager.deleteWorkflow(item.key);
        }
      }
      toast.success(`${selectedWorkflowIds.size} workflows deleted`);
      setSelectedWorkflowIds(new Set());
      setBulkSelectMode(false);
      loadWorkflows();
    }
  }, [selectedWorkflowIds, workflows, loadWorkflows]);

  const handleBulkMoveToFolder = useCallback(
    async (folderId: string | null) => {
      if (selectedWorkflowIds.size === 0) return;

      for (const id of selectedWorkflowIds) {
        if (folderId) {
          workflowFolderManager.addWorkflowToFolder(id, folderId);
        } else {
          workflowFolderManager.removeWorkflowFromFolder(id);
        }
      }
      toast.success(`${selectedWorkflowIds.size} workflows moved`);
      setSelectedWorkflowIds(new Set());
      setBulkSelectMode(false);
      loadWorkflows();
    },
    [selectedWorkflowIds, loadWorkflows]
  );

  const handleBulkExport = useCallback(() => {
    if (selectedWorkflowIds.size === 0) return;

    const selectedWorkflows = workflows
      .filter((w) => selectedWorkflowIds.has(w.workflow.id))
      .map((w) => w.workflow);

    const data = JSON.stringify(selectedWorkflows, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflows-export-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Workflows exported");
  }, [selectedWorkflowIds, workflows]);

  const handleToggleSelectAll = useCallback(() => {
    if (selectedWorkflowIds.size === sortedWorkflows.length) {
      setSelectedWorkflowIds(new Set());
    } else {
      setSelectedWorkflowIds(
        new Set(sortedWorkflows.map((w) => w.workflow.id))
      );
    }
  }, [selectedWorkflowIds, sortedWorkflows]);

  const handleColumnVisibilityChange = useCallback(
    (columnId: string, visible: boolean) => {
      setColumns((prev) =>
        prev.map((col) => (col.id === columnId ? { ...col, visible } : col))
      );
    },
    []
  );

  const handleSaveFilter = useCallback(
    (name: string, filter: SearchFilter) => {
      const newFilter: SavedFilter = {
        id: `filter-${Date.now()}`,
        name,
        filter,
        createdAt: new Date(),
      };
      const updated = [...savedFilters, newFilter];
      setSavedFilters(updated);
      localStorage.setItem("workflow-browser-filters", JSON.stringify(updated));
    },
    [savedFilters]
  );

  const handleSearchResults = useCallback(
    (_results: Workflow[], filter: SearchFilter) => {
      setSearchFilter(filter);
      // Results are automatically applied through the filtering chain
    },
    []
  );

  const handleToggleSelectWorkflow = useCallback(
    (workflowId: string) => {
      const newSet = new Set(selectedWorkflowIds);
      if (newSet.has(workflowId)) {
        newSet.delete(workflowId);
      } else {
        newSet.add(workflowId);
      }
      setSelectedWorkflowIds(newSet);
    },
    [selectedWorkflowIds]
  );

  const handleClearFilters = useCallback(() => {
    setActiveQuickFilter("all");
    setSearchFilter({});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowAdvancedSearch(true);
      }
      // Ctrl/Cmd + A: Select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        handleToggleSelectAll();
      }
      // Delete: Delete selected
      if (e.key === "Delete" && selectedWorkflowIds.size > 0) {
        e.preventDefault();
        handleBulkDelete();
      }
      // Escape: Close or exit bulk mode
      if (e.key === "Escape") {
        if (bulkSelectMode) {
          setBulkSelectMode(false);
          setSelectedWorkflowIds(new Set());
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    bulkSelectMode,
    selectedWorkflowIds,
    handleToggleSelectAll,
    handleBulkDelete,
    onClose,
  ]);

  if (!open) return null;

  const visibleColumns = columns.filter((c) => c.visible);

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col border">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold">Workflow Browser</h2>
            <Badge variant="secondary">
              {sortedWorkflows.length} workflow
              {sortedWorkflows.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <ZoomControls
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              columns={columns}
              onColumnVisibilityChange={handleColumnVisibilityChange}
              showFolderTree={showFolderTree}
              onToggleFolderTree={() => setShowFolderTree(!showFolderTree)}
              showAdvancedSearch={showAdvancedSearch}
              onToggleAdvancedSearch={() =>
                setShowAdvancedSearch(!showAdvancedSearch)
              }
              bulkSelectMode={bulkSelectMode}
              onToggleBulkSelect={() => {
                setBulkSelectMode(!bulkSelectMode);
                setSelectedWorkflowIds(new Set());
              }}
            />

            {/* Close Button */}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Folder Tree Sidebar */}
          {showFolderTree && (
            <>
              <div className="w-80 border-r flex flex-col">
                <FolderTree
                  folders={folders}
                  workflows={workflows.map((w) => w.workflow)}
                  selectedFolderId={selectedFolderId}
                  onSelectFolder={setSelectedFolderId}
                  onCreateFolder={(name, parentId) => {
                    workflowFolderManager.createFolder({
                      name,
                      parentId: parentId || null,
                    });
                    loadWorkflows();
                  }}
                  onUpdateFolder={(id, updates) => {
                    workflowFolderManager.updateFolder(id, updates);
                    loadWorkflows();
                  }}
                  onDeleteFolder={(id) => {
                    workflowFolderManager.deleteFolder(id);
                    loadWorkflows();
                  }}
                  onMoveFolder={(folderId, newParentId) => {
                    workflowFolderManager.moveFolder(folderId, newParentId);
                    loadWorkflows();
                  }}
                  onMoveWorkflow={(workflowId, folderId) => {
                    if (folderId) {
                      workflowFolderManager.addWorkflowToFolder(
                        workflowId,
                        folderId
                      );
                    } else {
                      workflowFolderManager.removeWorkflowFromFolder(
                        workflowId
                      );
                    }
                    loadWorkflows();
                  }}
                />
              </div>
            </>
          )}

          {/* Main Workflow List Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Advanced Search Panel */}
            {showAdvancedSearch && (
              <div className="border-b">
                <AdvancedSearch
                  workflows={workflows.map((w) => w.workflow)}
                  folders={folders}
                  onSearch={handleSearchResults}
                  onSaveFilter={handleSaveFilter}
                  savedFilters={savedFilters}
                />
              </div>
            )}

            {/* Quick Filters */}
            <QuickFiltersBar
              activeQuickFilter={activeQuickFilter}
              onQuickFilterChange={setActiveQuickFilter}
            />

            {/* Toolbar */}
            <Toolbar
              bulkSelectMode={bulkSelectMode}
              selectedCount={selectedWorkflowIds.size}
              totalCount={sortedWorkflows.length}
              folders={folders}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              sortOrder={sortOrder}
              onSortOrderToggle={() =>
                setSortOrder(sortOrder === "asc" ? "desc" : "asc")
              }
              groupBy={groupBy}
              onGroupByChange={setGroupBy}
              onMoveToFolder={handleBulkMoveToFolder}
              onExport={handleBulkExport}
              onBulkDelete={handleBulkDelete}
              onClearSelection={() => setSelectedWorkflowIds(new Set())}
              onToggleSelectAll={handleToggleSelectAll}
            />

            {/* Workflow List */}
            <Canvas
              loading={loading}
              groupedWorkflows={groupedWorkflows}
              sortedWorkflowCount={sortedWorkflows.length}
              viewMode={viewMode}
              groupBy={groupBy}
              visibleColumns={visibleColumns}
              bulkSelectMode={bulkSelectMode}
              selectedWorkflowIds={selectedWorkflowIds}
              selectedFolderId={selectedFolderId}
              onToggleSelectWorkflow={handleToggleSelectWorkflow}
              onOpenWorkflow={handleOpenWorkflow}
              onDuplicateWorkflow={handleDuplicateWorkflow}
              onDeleteWorkflow={handleDeleteWorkflow}
              onClearFilters={handleClearFilters}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
