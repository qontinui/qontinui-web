import { useState, useMemo, useCallback } from "react";
import { Workflow } from "../../../../lib/action-schema/action-types";
import type { SearchFilter } from "../../../workflow-organization/types";
import {
  QUICK_FILTERS,
  DEFAULT_COLUMNS,
  type EnhancedWorkflowItem,
  type ViewMode,
  type SortBy,
  type SortOrder,
  type GroupBy,
  type ColumnConfig,
  type WorkflowGroup,
} from "../types";

export function useWorkflowFiltering(workflows: EnhancedWorkflowItem[]) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<SearchFilter>({});
  const [activeQuickFilter, setActiveQuickFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("modified");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

  const folderFilteredWorkflows = useMemo(() => {
    if (selectedFolderId === null) {
      return workflows;
    }
    if (selectedFolderId === "uncategorized") {
      return workflows.filter((w) => !w.folderId);
    }
    return workflows.filter((w) => w.folderId === selectedFolderId);
  }, [workflows, selectedFolderId]);

  const searchFilteredWorkflows = useMemo(() => {
    if (Object.keys(searchFilter).length === 0) {
      return folderFilteredWorkflows;
    }
    return folderFilteredWorkflows;
  }, [folderFilteredWorkflows, searchFilter]);

  const quickFilteredWorkflows = useMemo(() => {
    const quickFilter = QUICK_FILTERS.find((qf) => qf.id === activeQuickFilter);
    if (!quickFilter || quickFilter.id === "all") {
      return searchFilteredWorkflows;
    }
    return searchFilteredWorkflows.filter(quickFilter.filter);
  }, [searchFilteredWorkflows, activeQuickFilter]);

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

  const groupedWorkflows: WorkflowGroup[] = useMemo(() => {
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
            tags.forEach((tag) => {
              if (!groups.has(tag)) {
                groups.set(tag, []);
              }
              groups.get(tag)!.push(item);
            });
            return;
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

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible),
    [columns]
  );

  const handleColumnVisibilityChange = useCallback(
    (columnId: string, visible: boolean) => {
      setColumns((prev) =>
        prev.map((col) => (col.id === columnId ? { ...col, visible } : col))
      );
    },
    []
  );

  const handleSearchResults = useCallback(
    (_results: Workflow[], filter: SearchFilter) => {
      setSearchFilter(filter);
    },
    []
  );

  const handleClearFilters = useCallback(() => {
    setActiveQuickFilter("all");
    setSearchFilter({});
  }, []);

  return {
    viewMode,
    setViewMode,
    selectedFolderId,
    setSelectedFolderId,
    activeQuickFilter,
    setActiveQuickFilter,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    groupBy,
    setGroupBy,
    columns,
    showAdvancedSearch,
    setShowAdvancedSearch,
    sortedWorkflows,
    groupedWorkflows,
    visibleColumns,
    handleColumnVisibilityChange,
    handleSearchResults,
    handleClearFilters,
  };
}
