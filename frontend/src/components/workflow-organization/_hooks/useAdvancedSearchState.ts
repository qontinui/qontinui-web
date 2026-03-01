/**
 * useAdvancedSearchState Hook
 *
 * Manages all state, filter assembly, and derived values for the
 * AdvancedSearch component.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import {
  SearchFilter,
  SavedFilter,
  ComplexityLevel,
  WorkflowExecutionStats,
} from "../types";
import {
  useDebounce,
  matchesFilter,
  getAllTags,
  getAllActionTypes,
  getAllCategories,
} from "../search-filter-utils";
import { toast } from "sonner";

export interface UseAdvancedSearchStateInput {
  workflows: Workflow[];
  onSearch: (results: Workflow[], filter: SearchFilter) => void;
  onSaveFilter: (name: string, filter: SearchFilter) => void;
  executionStats?: Map<string, WorkflowExecutionStats>;
}

export interface UseAdvancedSearchStateResult {
  // Expand/collapse
  isExpanded: boolean;
  setIsExpanded: (v: boolean) => void;

  // Core filter state
  filter: SearchFilter;
  setFilter: (f: SearchFilter) => void;
  textQuery: string;
  setTextQuery: (q: string) => void;

  // Save dialog
  showSaveDialog: boolean;
  setShowSaveDialog: (v: boolean) => void;
  filterName: string;
  setFilterName: (name: string) => void;

  // Selection state
  selectedFolderIds: string[];
  setSelectedFolderIds: (ids: string[]) => void;
  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;
  selectedActionTypes: string[];
  setSelectedActionTypes: (types: string[]) => void;
  selectedComplexity: ComplexityLevel[];
  setSelectedComplexity: (levels: ComplexityLevel[]) => void;

  // Execution history filter state
  minSuccessRate: number | undefined;
  setMinSuccessRate: (rate: number | undefined) => void;
  minRunCount: number | undefined;
  setMinRunCount: (count: number | undefined) => void;

  // Derived/computed values
  availableTags: string[];
  availableActionTypes: string[];
  availableCategories: string[];
  filteredWorkflows: Workflow[];
  isFilterActive: boolean;

  // Handlers
  handleClearAll: () => void;
  handleSaveFilter: () => void;
  handleLoadFilter: (savedFilter: SavedFilter) => void;
  handleExportResults: () => void;
}

export function useAdvancedSearchState({
  workflows,
  onSearch,
  onSaveFilter,
  executionStats,
}: UseAdvancedSearchStateInput): UseAdvancedSearchStateResult {
  // State
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState<SearchFilter>({});
  const [textQuery, setTextQuery] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedActionTypes, setSelectedActionTypes] = useState<string[]>([]);
  const [selectedComplexity, setSelectedComplexity] = useState<
    ComplexityLevel[]
  >([]);
  // Execution history filter state
  const [minSuccessRate, setMinSuccessRate] = useState<number | undefined>(
    undefined
  );
  const [minRunCount, setMinRunCount] = useState<number | undefined>(undefined);

  // Debounce text query
  const debouncedQuery = useDebounce(textQuery, 300);

  // Extract available options
  const availableTags = useMemo(() => getAllTags(workflows), [workflows]);
  const availableActionTypes = useMemo(
    () => getAllActionTypes(workflows),
    [workflows]
  );
  const availableCategories = useMemo(
    () => getAllCategories(workflows),
    [workflows]
  );

  // Build filter object
  useEffect(() => {
    const newFilter: SearchFilter = {};

    if (debouncedQuery) newFilter.query = debouncedQuery;
    if (selectedFolderIds.length > 0) newFilter.folderIds = selectedFolderIds;
    if (selectedTags.length > 0) {
      newFilter.tags = selectedTags;
      newFilter.tagOperator = filter.tagOperator || "OR";
    }
    if (filter.createdDateRange?.from || filter.createdDateRange?.to) {
      newFilter.createdDateRange = filter.createdDateRange;
    }
    if (filter.modifiedDateRange?.from || filter.modifiedDateRange?.to) {
      newFilter.modifiedDateRange = filter.modifiedDateRange;
    }
    if (selectedActionTypes.length > 0)
      newFilter.actionTypes = selectedActionTypes;
    if (selectedComplexity.length > 0)
      newFilter.complexityLevel = selectedComplexity;
    if (filter.category) newFilter.category = filter.category;
    if (filter.hasTests !== undefined && filter.hasTests !== null) {
      newFilter.hasTests = filter.hasTests;
    }
    if (
      filter.hasDocumentation !== undefined &&
      filter.hasDocumentation !== null
    ) {
      newFilter.hasDocumentation = filter.hasDocumentation;
    }
    // Execution history filters
    if (minSuccessRate !== undefined) {
      newFilter.minSuccessRate = minSuccessRate;
    }
    if (minRunCount !== undefined) {
      newFilter.minRunCount = minRunCount;
    }
    if (filter.lastRunDateRange?.from || filter.lastRunDateRange?.to) {
      newFilter.lastRunDateRange = filter.lastRunDateRange;
    }
    if (
      filter.hasBeenExecuted !== undefined &&
      filter.hasBeenExecuted !== null
    ) {
      newFilter.hasBeenExecuted = filter.hasBeenExecuted;
    }

    setFilter(newFilter);
  }, [
    debouncedQuery,
    selectedFolderIds,
    selectedTags,
    selectedActionTypes,
    selectedComplexity,
    filter.tagOperator,
    filter.createdDateRange,
    filter.modifiedDateRange,
    filter.category,
    filter.hasTests,
    filter.hasDocumentation,
    minSuccessRate,
    minRunCount,
    filter.lastRunDateRange,
    filter.hasBeenExecuted,
  ]);

  // Filter workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => matchesFilter(w, filter, executionStats));
  }, [workflows, filter, executionStats]);

  // Trigger search callback
  useEffect(() => {
    onSearch(filteredWorkflows, filter);
  }, [filteredWorkflows, filter, onSearch]);

  // Handlers
  const handleClearAll = useCallback(() => {
    setTextQuery("");
    setSelectedFolderIds([]);
    setSelectedTags([]);
    setSelectedActionTypes([]);
    setSelectedComplexity([]);
    setMinSuccessRate(undefined);
    setMinRunCount(undefined);
    setFilter({});
    toast.success("Filters cleared");
  }, []);

  const handleSaveFilter = useCallback(() => {
    if (!filterName.trim()) {
      toast.error("Please enter a filter name");
      return;
    }

    onSaveFilter(filterName.trim(), filter);
    setShowSaveDialog(false);
    setFilterName("");
    toast.success(`Filter "${filterName}" saved`);
  }, [filterName, filter, onSaveFilter]);

  const handleLoadFilter = useCallback((savedFilter: SavedFilter) => {
    const f = savedFilter.filter;
    setTextQuery(f.query || "");
    setSelectedFolderIds(f.folderIds || []);
    setSelectedTags(f.tags || []);
    setSelectedActionTypes(f.actionTypes || []);
    setSelectedComplexity(f.complexityLevel || []);
    setMinSuccessRate(f.minSuccessRate);
    setMinRunCount(f.minRunCount);
    setFilter(f);
    toast.success(`Filter "${savedFilter.name}" loaded`);
  }, []);

  const handleExportResults = useCallback(() => {
    const data = JSON.stringify(filteredWorkflows, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-search-results-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Results exported");
  }, [filteredWorkflows]);

  const isFilterActive = Object.keys(filter).length > 0;

  return {
    isExpanded,
    setIsExpanded,
    filter,
    setFilter,
    textQuery,
    setTextQuery,
    showSaveDialog,
    setShowSaveDialog,
    filterName,
    setFilterName,
    selectedFolderIds,
    setSelectedFolderIds,
    selectedTags,
    setSelectedTags,
    selectedActionTypes,
    setSelectedActionTypes,
    selectedComplexity,
    setSelectedComplexity,
    minSuccessRate,
    setMinSuccessRate,
    minRunCount,
    setMinRunCount,
    availableTags,
    availableActionTypes,
    availableCategories,
    filteredWorkflows,
    isFilterActive,
    handleClearAll,
    handleSaveFilter,
    handleLoadFilter,
    handleExportResults,
  };
}
