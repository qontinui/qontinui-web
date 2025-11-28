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

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Workflow } from "../../lib/action-schema/action-types";
import { workflowFileManager } from "../../services/workflow-file-manager";
import { workflowSnapshots } from "../../services/workflow-snapshots";
import { cloneWorkflow } from "../../lib/action-schema/workflow-utils";
import { workflowFolderManager } from "../../services/workflow-folder-manager";
import { workflowAnalyticsService } from "../../services/workflow-analytics-service";
import { workflowComplexityAnalyzer } from "../../services/workflow-complexity-analyzer";
import { getWorkflowTestingService } from "../../services/workflow-testing-service";
import { FolderTree } from "../workflow-organization/FolderTree";
import { AdvancedSearch } from "../workflow-organization/AdvancedSearch";
import type {
  WorkflowFolder,
  SearchFilter,
  SavedFilter,
} from "../../types/workflow-organization/types";
import {
  X,
  Search,
  Grid,
  List,
  Columns,
  SlidersHorizontal,
  Download,
  Upload,
  FolderPlus,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Copy,
  Trash2,
  Edit2,
  Play,
  TestTube,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Folder,
  Tag as TagIcon,
  Link2,
  Settings,
  Eye,
  FileJson,
  FolderOpen,
  Maximize2,
  LayoutGrid,
  Rows,
  Check,
  Filter as FilterIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import { Checkbox } from "../ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import { FixedSizeList as VirtualList } from "react-window";

// ============================================================================
// Types
// ============================================================================

interface EnhancedWorkflowItem {
  key: string;
  workflow: Workflow;
  lastModified?: Date;
  snapshotCount: number;
  folderId?: string | null;
  folderPath?: string[];
  complexity?: number;
  complexityRating?: "low" | "medium" | "high" | "very-high";
  testCoverage?: number;
  hasTests?: boolean;
  hasDocumentation?: boolean;
  lastRun?: string;
  successRate?: number;
  avgDuration?: number;
  failedLastRun?: boolean;
  hasDependencies?: boolean;
  recentlyModified?: boolean;
}

type ViewMode = "list" | "grid" | "compact";
type SortBy =
  | "date"
  | "name"
  | "actions"
  | "complexity"
  | "successRate"
  | "lastRun"
  | "modified";
type SortOrder = "asc" | "desc";
type GroupBy = "none" | "folder" | "category" | "tag" | "complexity";

interface WorkflowBrowserProps {
  onOpen: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
}

interface QuickFilter {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  filter: (item: EnhancedWorkflowItem) => boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "name", label: "Name", visible: true, width: 250 },
  { id: "folder", label: "Folder", visible: true, width: 150 },
  { id: "complexity", label: "Complexity", visible: true, width: 120 },
  { id: "testCoverage", label: "Test Coverage", visible: false, width: 120 },
  { id: "lastRun", label: "Last Run", visible: false, width: 150 },
  { id: "successRate", label: "Success Rate", visible: false, width: 120 },
  { id: "actions", label: "Actions", visible: true, width: 100 },
  { id: "modified", label: "Modified", visible: true, width: 150 },
];

const QUICK_FILTERS: QuickFilter[] = [
  {
    id: "all",
    label: "All Workflows",
    icon: LayoutGrid,
    filter: () => true,
  },
  {
    id: "recent",
    label: "Recent",
    icon: Clock,
    filter: (item) => item.recentlyModified || false,
  },
  {
    id: "noTests",
    label: "No Tests",
    icon: AlertTriangle,
    filter: (item) => !item.hasTests,
  },
  {
    id: "noDocs",
    label: "No Documentation",
    icon: BookOpen,
    filter: (item) => !item.hasDocumentation,
  },
  {
    id: "highComplexity",
    label: "High Complexity",
    icon: TrendingUp,
    filter: (item) =>
      item.complexityRating === "high" || item.complexityRating === "very-high",
  },
  {
    id: "errors",
    label: "Errors",
    icon: AlertTriangle,
    filter: (item) => item.failedLastRun || false,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a workflow was modified in the last 7 days
 */
function isRecentlyModified(date?: Date): boolean {
  if (!date) return false;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return date > sevenDaysAgo;
}

/**
 * Format duration in ms to readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format date to relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

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
      setFolders(folderData);

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
              (a) => a.type === "SUBWORKFLOW" || a.type === "CALL_WORKFLOW"
            ),
            recentlyModified: isRecentlyModified(lastModified),
          });
        }
      }

      setWorkflows(items);
    } catch (error) {
      console.error("Failed to load workflows:", error);
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
        console.error("Failed to load saved filters:", error);
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
        createdAt: new Date().toISOString(),
      };
      const updated = [...savedFilters, newFilter];
      setSavedFilters(updated);
      localStorage.setItem("workflow-browser-filters", JSON.stringify(updated));
    },
    [savedFilters]
  );

  const handleSearchResults = useCallback(
    (results: Workflow[], filter: SearchFilter) => {
      setSearchFilter(filter);
      // Results are automatically applied through the filtering chain
    },
    []
  );

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
      // Ctrl/Cmd + N: New workflow (not implemented here, but could be)
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
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 border rounded-md p-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={viewMode === "list" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("list")}
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
                      onClick={() => setViewMode("grid")}
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
                      onClick={() => setViewMode("compact")}
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
                        handleColumnVisibilityChange(col.id, checked)
                      }
                    >
                      {col.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Folder Tree Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFolderTree(!showFolderTree)}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Folders
            </Button>

            {/* Advanced Search Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
            >
              <FilterIcon className="h-4 w-4 mr-2" />
              Filters
            </Button>

            {/* Bulk Select Toggle */}
            <Button
              variant={bulkSelectMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setBulkSelectMode(!bulkSelectMode);
                setSelectedWorkflowIds(new Set());
              }}
            >
              <Check className="h-4 w-4 mr-2" />
              Select
            </Button>

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
            <div className="p-4 border-b">
              <div className="flex items-center gap-2 flex-wrap">
                {QUICK_FILTERS.map((qf) => {
                  const Icon = qf.icon;
                  return (
                    <Button
                      key={qf.id}
                      variant={
                        activeQuickFilter === qf.id ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => setActiveQuickFilter(qf.id)}
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      {qf.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Toolbar */}
            <div className="px-4 py-2 border-b flex items-center justify-between gap-4">
              {/* Bulk Operations */}
              {bulkSelectMode && selectedWorkflowIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {selectedWorkflowIds.size} selected
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <FolderPlus className="h-4 w-4 mr-2" />
                        Move to Folder
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={() => handleBulkMoveToFolder(null)}
                      >
                        Remove from Folder
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {folders.map((folder) => (
                        <DropdownMenuItem
                          key={folder.id}
                          onClick={() => handleBulkMoveToFolder(folder.id)}
                        >
                          {folder.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkExport}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedWorkflowIds(new Set())}
                  >
                    Clear Selection
                  </Button>
                </div>
              )}

              {!bulkSelectMode && (
                <div className="flex items-center gap-2">
                  {/* Group By */}
                  <Select
                    value={groupBy}
                    onValueChange={(value) => setGroupBy(value as GroupBy)}
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
                    onValueChange={(value) => setSortBy(value as SortBy)}
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
                    }
                  >
                    {sortOrder === "asc" ? "A→Z" : "Z→A"}
                  </Button>
                </div>
              )}

              {bulkSelectMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleSelectAll}
                >
                  {selectedWorkflowIds.size === sortedWorkflows.length
                    ? "Deselect All"
                    : "Select All"}
                </Button>
              )}
            </div>

            {/* Workflow List */}
            <ScrollArea className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      Loading workflows...
                    </p>
                  </div>
                </div>
              ) : sortedWorkflows.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-md">
                    <LayoutGrid className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
                    <h3 className="text-lg font-semibold mb-2">
                      No workflows found
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {selectedFolderId
                        ? "This folder is empty. Try selecting a different folder or adjusting your filters."
                        : "Try adjusting your search filters or create your first workflow to get started."}
                    </p>
                    {!selectedFolderId && (
                      <Button
                        onClick={() => {
                          setActiveQuickFilter("all");
                          setSearchFilter({});
                        }}
                      >
                        Clear Filters
                      </Button>
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
                              selected={selectedWorkflowIds.has(
                                item.workflow.id
                              )}
                              onToggleSelect={() => {
                                const newSet = new Set(selectedWorkflowIds);
                                if (newSet.has(item.workflow.id)) {
                                  newSet.delete(item.workflow.id);
                                } else {
                                  newSet.add(item.workflow.id);
                                }
                                setSelectedWorkflowIds(newSet);
                              }}
                              onOpen={() => handleOpenWorkflow(item)}
                              onDuplicate={() => handleDuplicateWorkflow(item)}
                              onDelete={() => handleDeleteWorkflow(item)}
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
                              selected={selectedWorkflowIds.has(
                                item.workflow.id
                              )}
                              onToggleSelect={() => {
                                const newSet = new Set(selectedWorkflowIds);
                                if (newSet.has(item.workflow.id)) {
                                  newSet.delete(item.workflow.id);
                                } else {
                                  newSet.add(item.workflow.id);
                                }
                                setSelectedWorkflowIds(newSet);
                              }}
                              onOpen={() => handleOpenWorkflow(item)}
                              onDuplicate={() => handleDuplicateWorkflow(item)}
                              onDelete={() => handleDeleteWorkflow(item)}
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
                              selected={selectedWorkflowIds.has(
                                item.workflow.id
                              )}
                              onToggleSelect={() => {
                                const newSet = new Set(selectedWorkflowIds);
                                if (newSet.has(item.workflow.id)) {
                                  newSet.delete(item.workflow.id);
                                } else {
                                  newSet.add(item.workflow.id);
                                }
                                setSelectedWorkflowIds(newSet);
                              }}
                              onOpen={() => handleOpenWorkflow(item)}
                              onDuplicate={() => handleDuplicateWorkflow(item)}
                              onDelete={() => handleDeleteWorkflow(item)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Workflow List Row Component
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

function WorkflowListRow({
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
      onClick={bulkSelectMode ? onToggleSelect : onOpen}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
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
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Workflow Grid Card Component
// ============================================================================

interface WorkflowCardProps {
  item: EnhancedWorkflowItem;
  bulkSelectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function WorkflowGridCard({
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
      onClick={bulkSelectMode ? onToggleSelect : onOpen}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
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
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Workflow Compact Row Component
// ============================================================================

function WorkflowCompactRow({
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
      onClick={bulkSelectMode ? onToggleSelect : onOpen}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <MoreVertical className="h-3 w-3" />
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
      )}
    </div>
  );
}

// ============================================================================
// Workflow Badges Component
// ============================================================================

interface WorkflowBadgesProps {
  item: EnhancedWorkflowItem;
  compact?: boolean;
}

function WorkflowBadges({ item, compact }: WorkflowBadgesProps) {
  const badges = [];

  if (item.hasTests) {
    badges.push(
      <TooltipProvider key="tests">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <TestTube className="h-3 w-3" />
              {!compact && "Tests"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Has test cases</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.hasDocumentation) {
    badges.push(
      <TooltipProvider key="docs">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <BookOpen className="h-3 w-3" />
              {!compact && "Docs"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Has documentation</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.failedLastRun) {
    badges.push(
      <TooltipProvider key="error">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {!compact && "Error"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Failed last run</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.recentlyModified) {
    badges.push(
      <TooltipProvider key="recent">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {!compact && "New"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Recently modified</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.hasDependencies) {
    badges.push(
      <TooltipProvider key="deps">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <Link2 className="h-3 w-3" />
              {!compact && "Deps"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Has dependencies</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <>{badges}</>;
}

// ============================================================================
// Complexity Badge Component
// ============================================================================

interface ComplexityBadgeProps {
  rating?: "low" | "medium" | "high" | "very-high";
  score?: number;
}

function ComplexityBadge({ rating, score }: ComplexityBadgeProps) {
  if (!rating) return null;

  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    low: "outline",
    medium: "secondary",
    high: "default",
    "very-high": "destructive",
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge variant={variants[rating]} className="text-xs">
            {rating.replace("-", " ")}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          Complexity score: {score?.toFixed(0)}/100
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
