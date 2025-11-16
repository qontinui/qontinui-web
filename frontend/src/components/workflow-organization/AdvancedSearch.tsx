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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Filter,
  X,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  Folder,
  Tag,
  Calendar,
  Zap,
  BarChart3,
  FileCheck,
  BookOpen,
  TrendingUp,
  RotateCcw,
} from 'lucide-react';
import { Workflow } from '../../lib/action-schema/action-types';
import { WorkflowFolder, SearchFilter, SavedFilter, ComplexityLevel } from './types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Slider } from '../ui/slider';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Checkbox } from '../ui/checkbox';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

export interface AdvancedSearchProps {
  workflows: Workflow[];
  folders: WorkflowFolder[];
  onSearch: (results: Workflow[], filter: SearchFilter) => void;
  onSaveFilter: (name: string, filter: SearchFilter) => void;
  savedFilters?: SavedFilter[];
  className?: string;
}

interface MultiSelectItem {
  id: string;
  label: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Debounce function for text input
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Calculate workflow complexity based on action count and types
 */
function calculateComplexity(workflow: Workflow): ComplexityLevel {
  const actionCount = workflow.actions.length;
  const hasControlFlow = workflow.actions.some((a) =>
    ['IF', 'LOOP', 'SWITCH', 'TRY_CATCH'].includes(a.type)
  );
  const hasDataOps = workflow.actions.some((a) =>
    ['MAP', 'REDUCE', 'FILTER', 'SORT'].includes(a.type)
  );

  if (actionCount <= 5 && !hasControlFlow && !hasDataOps) return 'low';
  if (actionCount <= 15 && (!hasControlFlow || !hasDataOps)) return 'medium';
  if (actionCount <= 30) return 'high';
  return 'very-high';
}

/**
 * Check if workflow matches search filter
 */
function matchesFilter(workflow: Workflow, filter: SearchFilter): boolean {
  // Text search
  if (filter.query) {
    const query = filter.query.toLowerCase();
    const searchableText = [
      workflow.name,
      workflow.description || '',
      ...(workflow.tags || []),
    ]
      .join(' ')
      .toLowerCase();

    if (!searchableText.includes(query)) {
      return false;
    }
  }

  // Folder filter
  if (filter.folderIds && filter.folderIds.length > 0) {
    const workflowFolderId = (workflow as any).folderId || null;
    if (!filter.folderIds.includes(workflowFolderId)) {
      return false;
    }
  }

  // Tag filter
  if (filter.tags && filter.tags.length > 0) {
    const workflowTags = workflow.tags || [];
    if (filter.tagOperator === 'AND') {
      // All tags must match
      if (!filter.tags.every((tag) => workflowTags.includes(tag))) {
        return false;
      }
    } else {
      // At least one tag must match
      if (!filter.tags.some((tag) => workflowTags.includes(tag))) {
        return false;
      }
    }
  }

  // Date range filters
  const created = workflow.metadata?.created
    ? new Date(workflow.metadata.created)
    : null;
  const updated = workflow.metadata?.updated
    ? new Date(workflow.metadata.updated)
    : null;

  if (filter.createdDateRange?.from && created) {
    if (created < filter.createdDateRange.from) {
      return false;
    }
  }

  if (filter.createdDateRange?.to && created) {
    if (created > filter.createdDateRange.to) {
      return false;
    }
  }

  if (filter.modifiedDateRange?.from && updated) {
    if (updated < filter.modifiedDateRange.from) {
      return false;
    }
  }

  if (filter.modifiedDateRange?.to && updated) {
    if (updated > filter.modifiedDateRange.to) {
      return false;
    }
  }

  // Action types filter
  if (filter.actionTypes && filter.actionTypes.length > 0) {
    const workflowActionTypes = new Set(workflow.actions.map((a) => a.type));
    if (!filter.actionTypes.some((type) => workflowActionTypes.has(type))) {
      return false;
    }
  }

  // Complexity filter
  if (filter.complexityLevel && filter.complexityLevel.length > 0) {
    const complexity = calculateComplexity(workflow);
    if (!filter.complexityLevel.includes(complexity)) {
      return false;
    }
  }

  // Category filter
  if (filter.category && workflow.category !== filter.category) {
    return false;
  }

  // Has tests filter
  if (filter.hasTests !== null && filter.hasTests !== undefined) {
    const hasTests = Boolean(workflow.initialScreenshotId);
    if (hasTests !== filter.hasTests) {
      return false;
    }
  }

  // Has documentation filter
  if (filter.hasDocumentation !== null && filter.hasDocumentation !== undefined) {
    const hasDoc = Boolean(workflow.description && workflow.description.length > 0);
    if (hasDoc !== filter.hasDocumentation) {
      return false;
    }
  }

  // Success rate filter (placeholder - would need execution history)
  // if (filter.minSuccessRate !== undefined) {
  //   // TODO: Implement when execution history is available
  // }

  return true;
}

/**
 * Get all unique tags from workflows
 */
function getAllTags(workflows: Workflow[]): string[] {
  const tagSet = new Set<string>();
  workflows.forEach((w) => {
    (w.tags || []).forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

/**
 * Get all unique action types from workflows
 */
function getAllActionTypes(workflows: Workflow[]): string[] {
  const typeSet = new Set<string>();
  workflows.forEach((w) => {
    w.actions.forEach((a) => typeSet.add(a.type));
  });
  return Array.from(typeSet).sort();
}

/**
 * Get all unique categories from workflows
 */
function getAllCategories(workflows: Workflow[]): string[] {
  const categorySet = new Set<string>();
  workflows.forEach((w) => {
    if (w.category) categorySet.add(w.category);
  });
  return Array.from(categorySet).sort();
}

// ============================================================================
// Main Component
// ============================================================================

export function AdvancedSearch({
  workflows,
  folders,
  onSearch,
  onSaveFilter,
  savedFilters = [],
  className,
}: AdvancedSearchProps) {
  // State
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState<SearchFilter>({});
  const [textQuery, setTextQuery] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedActionTypes, setSelectedActionTypes] = useState<string[]>([]);
  const [selectedComplexity, setSelectedComplexity] = useState<ComplexityLevel[]>([]);

  // Debounce text query
  const debouncedQuery = useDebounce(textQuery, 300);

  // Extract available options
  const availableTags = useMemo(() => getAllTags(workflows), [workflows]);
  const availableActionTypes = useMemo(() => getAllActionTypes(workflows), [workflows]);
  const availableCategories = useMemo(() => getAllCategories(workflows), [workflows]);

  // Build filter object
  useEffect(() => {
    const newFilter: SearchFilter = {};

    if (debouncedQuery) newFilter.query = debouncedQuery;
    if (selectedFolderIds.length > 0) newFilter.folderIds = selectedFolderIds;
    if (selectedTags.length > 0) {
      newFilter.tags = selectedTags;
      newFilter.tagOperator = filter.tagOperator || 'OR';
    }
    if (filter.createdDateRange?.from || filter.createdDateRange?.to) {
      newFilter.createdDateRange = filter.createdDateRange;
    }
    if (filter.modifiedDateRange?.from || filter.modifiedDateRange?.to) {
      newFilter.modifiedDateRange = filter.modifiedDateRange;
    }
    if (selectedActionTypes.length > 0) newFilter.actionTypes = selectedActionTypes;
    if (selectedComplexity.length > 0) newFilter.complexityLevel = selectedComplexity;
    if (filter.category) newFilter.category = filter.category;
    if (filter.hasTests !== undefined && filter.hasTests !== null) {
      newFilter.hasTests = filter.hasTests;
    }
    if (filter.hasDocumentation !== undefined && filter.hasDocumentation !== null) {
      newFilter.hasDocumentation = filter.hasDocumentation;
    }
    if (filter.minSuccessRate !== undefined) {
      newFilter.minSuccessRate = filter.minSuccessRate;
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
    filter.minSuccessRate,
  ]);

  // Filter workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => matchesFilter(w, filter));
  }, [workflows, filter]);

  // Trigger search callback
  useEffect(() => {
    onSearch(filteredWorkflows, filter);
  }, [filteredWorkflows, filter, onSearch]);

  // Handlers
  const handleClearAll = useCallback(() => {
    setTextQuery('');
    setSelectedFolderIds([]);
    setSelectedTags([]);
    setSelectedActionTypes([]);
    setSelectedComplexity([]);
    setFilter({});
    toast.success('Filters cleared');
  }, []);

  const handleSaveFilter = useCallback(() => {
    if (!filterName.trim()) {
      toast.error('Please enter a filter name');
      return;
    }

    onSaveFilter(filterName.trim(), filter);
    setShowSaveDialog(false);
    setFilterName('');
    toast.success(`Filter "${filterName}" saved`);
  }, [filterName, filter, onSaveFilter]);

  const handleLoadFilter = useCallback((savedFilter: SavedFilter) => {
    const f = savedFilter.filter;
    setTextQuery(f.query || '');
    setSelectedFolderIds(f.folderIds || []);
    setSelectedTags(f.tags || []);
    setSelectedActionTypes(f.actionTypes || []);
    setSelectedComplexity(f.complexityLevel || []);
    setFilter(f);
    toast.success(`Filter "${savedFilter.name}" loaded`);
  }, []);

  const handleExportResults = useCallback(() => {
    const data = JSON.stringify(filteredWorkflows, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-search-results-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Results exported');
  }, [filteredWorkflows]);

  const isFilterActive = Object.keys(filter).length > 0;

  return (
    <div className={cn('border rounded-lg bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Advanced Search</h3>
          {isFilterActive && (
            <Badge variant="secondary" className="ml-2">
              {filteredWorkflows.length} results
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isFilterActive && (
            <>
              <Button variant="ghost" size="sm" onClick={handleClearAll}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Clear All
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(true)}>
                <Save className="h-4 w-4 mr-2" />
                Save Filter
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportResults}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {isExpanded && (
        <ScrollArea className="max-h-[600px]">
          <div className="p-4 space-y-4">
            {/* Text Search */}
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, description, or tags..."
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
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
                  <Select onValueChange={(id) => {
                    const savedFilter = savedFilters.find((f) => f.id === id);
                    if (savedFilter) handleLoadFilter(savedFilter);
                  }}>
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
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <Label>Folders</Label>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                {folders.map((folder) => (
                  <label
                    key={folder.id}
                    className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedFolderIds.includes(folder.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedFolderIds([...selectedFolderIds, folder.id]);
                        } else {
                          setSelectedFolderIds(
                            selectedFolderIds.filter((id) => id !== folder.id)
                          );
                        }
                      }}
                    />
                    <span className="text-sm">{folder.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Tag Filter */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  <Label>Tags</Label>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant={filter.tagOperator === 'AND' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      setFilter({ ...filter, tagOperator: 'AND' })
                    }
                    className="h-7 px-2 text-xs"
                  >
                    AND
                  </Button>
                  <Button
                    variant={filter.tagOperator === 'OR' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      setFilter({ ...filter, tagOperator: 'OR' })
                    }
                    className="h-7 px-2 text-xs"
                  >
                    OR
                  </Button>
                </div>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                {availableTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedTags.includes(tag)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedTags([...selectedTags, tag]);
                        } else {
                          setSelectedTags(selectedTags.filter((t) => t !== tag));
                        }
                      }}
                    />
                    <span className="text-sm">{tag}</span>
                  </label>
                ))}
                {availableTags.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-2">
                    No tags available
                  </div>
                )}
              </div>
            </div>

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
                      const date = e.target.value ? new Date(e.target.value) : undefined;
                      setFilter({
                        ...filter,
                        createdDateRange: {
                          ...filter.createdDateRange,
                          from: date,
                        },
                      });
                    }}
                  />
                  <Input
                    type="date"
                    placeholder="To"
                    onChange={(e) => {
                      const date = e.target.value ? new Date(e.target.value) : undefined;
                      setFilter({
                        ...filter,
                        createdDateRange: {
                          ...filter.createdDateRange,
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
                      const date = e.target.value ? new Date(e.target.value) : undefined;
                      setFilter({
                        ...filter,
                        modifiedDateRange: {
                          ...filter.modifiedDateRange,
                          from: date,
                        },
                      });
                    }}
                  />
                  <Input
                    type="date"
                    placeholder="To"
                    onChange={(e) => {
                      const date = e.target.value ? new Date(e.target.value) : undefined;
                      setFilter({
                        ...filter,
                        modifiedDateRange: {
                          ...filter.modifiedDateRange,
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
                {availableActionTypes.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedActionTypes.includes(type)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedActionTypes([...selectedActionTypes, type]);
                        } else {
                          setSelectedActionTypes(
                            selectedActionTypes.filter((t) => t !== type)
                          );
                        }
                      }}
                    />
                    <span className="text-sm font-mono text-xs">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Complexity Level */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <Label>Complexity</Label>
              </div>
              <div className="space-y-1">
                {(['low', 'medium', 'high', 'very-high'] as ComplexityLevel[]).map(
                  (level) => (
                    <label
                      key={level}
                      className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedComplexity.includes(level)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedComplexity([...selectedComplexity, level]);
                          } else {
                            setSelectedComplexity(
                              selectedComplexity.filter((l) => l !== level)
                            );
                          }
                        }}
                      />
                      <span className="text-sm capitalize">{level.replace('-', ' ')}</span>
                    </label>
                  )
                )}
              </div>
            </div>

            <Separator />

            {/* Category */}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={filter.category || ''}
                onValueChange={(value) =>
                  setFilter({ ...filter, category: value || undefined })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All categories</SelectItem>
                  {availableCategories.map((cat) => (
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
                    filter.hasTests === null || filter.hasTests === undefined
                      ? 'all'
                      : filter.hasTests
                      ? 'yes'
                      : 'no'
                  }
                  onValueChange={(value) => {
                    setFilter({
                      ...filter,
                      hasTests: value === 'all' ? null : value === 'yes',
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
                    filter.hasDocumentation === null ||
                    filter.hasDocumentation === undefined
                      ? 'all'
                      : filter.hasDocumentation
                      ? 'yes'
                      : 'no'
                  }
                  onValueChange={(value) => {
                    setFilter({
                      ...filter,
                      hasDocumentation: value === 'all' ? null : value === 'yes',
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
          </div>
        </ScrollArea>
      )}

      {/* Save Filter Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Filter</DialogTitle>
            <DialogDescription>
              Save the current filter configuration for quick access later.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="filter-name">Filter Name</Label>
            <Input
              id="filter-name"
              placeholder="e.g., Complex workflows with tests"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveFilter}>Save Filter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
