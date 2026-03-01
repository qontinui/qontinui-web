"use client";

import { useState, DragEvent, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trash2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Workflow as WorkflowIcon,
  List,
  ArrowRightLeft,
  CheckSquare,
  X,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_CATEGORY_NAMES,
  useAutomation,
  type Category,
} from "@/contexts/automation-context";
import { DeleteCategoryDialog } from "@/components/delete-category-dialog";
import { DeleteWorkflowDialog } from "@/components/delete-process-dialog";
import { BatchDeleteWorkflowsDialog } from "@/components/batch-delete-workflows-dialog";
import type { Workflow } from "@/lib/action-schema/action-types";

// LibraryItem is now just Workflow - sequential workflows are linear graphs
type LibraryItem = Workflow;

interface UnifiedProcessLibraryProps {
  selectedItem: LibraryItem | null;
  onSelectItem: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onDeleteItems?: (items: LibraryItem[]) => void;
  onUpdateWorkflow?: (workflow: Workflow) => void;
  onCreateSequential?: (category: string) => void;
  onCreateGraph?: (category: string) => void;
  onConvertItem?: (item: LibraryItem) => void;
}

export function UnifiedProcessLibrary({
  selectedItem,
  onSelectItem,
  onDeleteItem,
  onDeleteItems,
  onUpdateWorkflow,
  onCreateSequential,
  onCreateGraph,
  onConvertItem,
}: UnifiedProcessLibraryProps) {
  const { workflows, categories, addCategory, deleteCategory, updateCategory } =
    useAutomation();

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set()
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [draggedItem, setDraggedItem] = useState<LibraryItem | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [deleteCategoryDialog, setDeleteCategoryDialog] = useState<{
    open: boolean;
    category: string;
    workflows: Workflow[];
  }>({ open: false, category: "", workflows: [] });
  const [deleteItemDialog, setDeleteItemDialog] = useState<{
    open: boolean;
    item: LibraryItem | null;
  }>({ open: false, item: null });

  // Selection mode state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialog, setBatchDeleteDialog] = useState(false);

  // Get all unique category names from workflows
  const workflowCategoryNames = [
    ...new Set(workflows.map((w) => w.category || "Main")),
  ];

  // Combine all categories - merge category objects with workflow categories
  // Categories from workflows that don't exist yet default to automationEnabled: false
  const categoryNames = categories.map((c) => c.name);
  const allCategoryNames = [
    ...new Set([...categoryNames, ...workflowCategoryNames]),
  ];

  // Build full Category objects for all categories
  const allCategories: Category[] = allCategoryNames.map((name) => {
    const existing = categories.find((c) => c.name === name);
    return existing || { name, automationEnabled: false };
  });

  // Group workflows by category name
  const itemsByCategory = allCategoryNames.reduce(
    (acc, categoryName) => {
      acc[categoryName] = workflows.filter(
        (w) => (w.category || "Main") === categoryName
      );
      return acc;
    },
    {} as Record<string, LibraryItem[]>
  );

  const getItemName = (item: LibraryItem) => {
    return item.name;
  };

  const getItemActionCount = (item: LibraryItem) => {
    return item.actions.length;
  };

  const isItemSelected = (item: LibraryItem) => {
    if (!selectedItem) return false;
    return selectedItem.id === item.id;
  };

  const isLinearWorkflow = (item: LibraryItem): boolean => {
    // Check if workflow has any branching in connections
    for (const sourceId in item.connections) {
      const outputs = item.connections[sourceId];
      if (!outputs) continue;

      if (outputs.error && outputs.error.length > 0) return false;
      if (outputs.success && outputs.success.length > 0) return false;
      if (outputs.main) {
        if (outputs.main.length > 1) return false;
        const firstMain = outputs.main[0];
        if (firstMain && firstMain.length > 1) return false;
      }
    }
    return true;
  };

  // Selection mode helpers
  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selections
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const toggleCategorySelection = useCallback(
    (category: string) => {
      const categoryItems = itemsByCategory[category] || [];
      const categoryIds = categoryItems.map((item) => item.id);
      const allSelected = categoryIds.every((id) => selectedIds.has(id));

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          // Deselect all in category
          categoryIds.forEach((id) => next.delete(id));
        } else {
          // Select all in category
          categoryIds.forEach((id) => next.add(id));
        }
        return next;
      });
    },
    [itemsByCategory, selectedIds]
  );

  const getSelectedItems = useCallback(() => {
    return workflows.filter((w) => selectedIds.has(w.id));
  }, [workflows, selectedIds]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size > 0) {
      setBatchDeleteDialog(true);
    }
  }, [selectedIds]);

  const handleConfirmBatchDelete = useCallback(() => {
    const itemsToDelete = getSelectedItems();
    if (itemsToDelete.length > 0 && onDeleteItems) {
      onDeleteItems(itemsToDelete);
      toast.success(
        `${itemsToDelete.length} workflow${itemsToDelete.length !== 1 ? "s" : ""} deleted`
      );
    } else if (itemsToDelete.length > 0) {
      // Fallback to individual deletes if batch delete not provided
      itemsToDelete.forEach((item) => onDeleteItem(item));
      toast.success(
        `${itemsToDelete.length} workflow${itemsToDelete.length !== 1 ? "s" : ""} deleted`
      );
    }
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    setBatchDeleteDialog(false);
  }, [getSelectedItems, onDeleteItems, onDeleteItem]);

  const handleDelete = (item: LibraryItem) => {
    setDeleteItemDialog({
      open: true,
      item,
    });
  };

  const handleConfirmDelete = () => {
    const item = deleteItemDialog.item;
    if (!item) return;

    const name = getItemName(item);
    const isLinear = isLinearWorkflow(item);
    const typeLabel = isLinear ? "sequential workflow" : "graph workflow";

    onDeleteItem(item);
    toast.success(
      `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} deleted`,
      {
        description: `"${name}" has been removed.`,
      }
    );
    setDeleteItemDialog({ open: false, item: null });
  };

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleAddCategory = () => {
    if (newCategoryName && !allCategoryNames.includes(newCategoryName)) {
      addCategory(newCategoryName);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
      toast.success("Category created", {
        description: `"${newCategoryName}" has been added.`,
      });
    }
  };

  const handleToggleAutomation = (category: Category) => {
    updateCategory({
      ...category,
      automationEnabled: !category.automationEnabled,
    });
    toast.success(
      category.automationEnabled
        ? `"${category.name}" removed from runner automation`
        : `"${category.name}" available for runner automation`
    );
  };

  const handleDeleteCategory = (category: string) => {
    const workflowsInCategory = workflows.filter(
      (w) => (w.category || "Main") === category
    );

    if (workflowsInCategory.length > 0) {
      setDeleteCategoryDialog({
        open: true,
        category,
        workflows: workflowsInCategory,
      });
    } else {
      deleteCategory(category);
      toast.success("Category deleted", {
        description: `"${category}" has been deleted.`,
      });
    }
  };

  const handleDeleteAllWorkflows = () => {
    const { category, workflows: workflowsInCategory } = deleteCategoryDialog;
    workflowsInCategory.forEach((workflow) => {
      onDeleteItem(workflow);
    });
    deleteCategory(category);
    toast.success("Category deleted", {
      description: `"${category}" and all its workflows have been deleted.`,
    });
    setDeleteCategoryDialog({ open: false, category: "", workflows: [] });
  };

  const handleMoveToMain = () => {
    const { category, workflows: workflowsInCategory } = deleteCategoryDialog;
    workflowsInCategory.forEach((workflow) => {
      if (onUpdateWorkflow) {
        onUpdateWorkflow({ ...workflow, category: "Main" });
      }
    });
    deleteCategory(category);
    toast.success("Category deleted", {
      description: `"${category}" has been deleted. All workflows moved to Main.`,
    });
    setDeleteCategoryDialog({ open: false, category: "", workflows: [] });
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, item: LibraryItem) => {
    // All workflows can be dragged
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverCategory(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleCategoryDragEnter = (category: string) => {
    // All workflows can be moved to any category
    setDragOverCategory(category);
  };

  const handleCategoryDragLeave = () => {
    setDragOverCategory(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, category: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggedItem && onUpdateWorkflow) {
      const updatedWorkflow = { ...draggedItem, category };
      onUpdateWorkflow(updatedWorkflow);
      toast.success("Workflow moved", {
        description: `"${draggedItem.name}" moved to ${category}`,
      });
    }

    setDraggedItem(null);
    setDragOverCategory(null);
  };

  const libraryItem = (item: LibraryItem) => {
    const isLinear = isLinearWorkflow(item);
    const isDraggable = !isSelectionMode; // Disable drag in selection mode
    const isChecked = selectedIds.has(item.id);

    return (
      <Card
        key={item.id}
        draggable={isDraggable}
        onDragStart={(e) => handleDragStart(e, item)}
        onDragEnd={handleDragEnd}
        className={`cursor-pointer transition-all hover:border-brand-primary/50 !py-0 !gap-0 ${
          isSelectionMode && isChecked
            ? "border-red-500 bg-red-500/10"
            : isItemSelected(item)
              ? isLinear
                ? "border-brand-primary bg-brand-primary/10"
                : "border-brand-success bg-brand-success/10"
              : "border-border-default bg-surface-raised"
        } ${draggedItem?.id === item.id ? "opacity-50" : ""}`}
        onClick={() => {
          if (isSelectionMode) {
            toggleItemSelection(item.id);
          } else {
            onSelectItem(item);
          }
        }}
      >
        <CardContent className="py-1 px-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {isSelectionMode && (
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggleItemSelection(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 flex-shrink-0 border-border-default data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                />
              )}
              {isLinear ? (
                <List className="w-3 h-3 text-brand-primary flex-shrink-0" />
              ) : (
                <WorkflowIcon className="w-3 h-3 text-brand-success flex-shrink-0" />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <h4 className="font-medium text-xs truncate">
                    {getItemName(item)}
                  </h4>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{getItemName(item)}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-1 ml-2">
              <Badge
                variant="secondary"
                className={`text-[10px] h-4 px-1 ${
                  !isLinear ? "bg-brand-success/20 text-brand-success" : ""
                }`}
              >
                {getItemActionCount(item)}
              </Badge>
              {!isSelectionMode && onConvertItem && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-text-muted hover:text-brand-success"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConvertItem(item);
                  }}
                  title={!isLinear ? "View as sequential" : "View as graph"}
                >
                  <ArrowRightLeft className="w-2.5 h-2.5" />
                </Button>
              )}
              {!isSelectionMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-text-muted hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item);
                  }}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-muted uppercase tracking-wide">
            Automation Library
          </h3>
          <div className="flex items-center gap-1">
            {isSelectionMode ? (
              <>
                <span className="text-xs text-text-muted">
                  {selectedIds.size} selected
                </span>
                {selectedIds.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={handleBatchDelete}
                    title="Delete selected workflows"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-text-muted hover:text-white"
                  onClick={toggleSelectionMode}
                  title="Cancel selection"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-text-muted hover:text-brand-primary flex items-center gap-1"
                  onClick={toggleSelectionMode}
                  title="Select multiple workflows"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-text-muted hover:text-brand-primary flex items-center gap-1"
                  onClick={() => setShowNewCategoryInput(true)}
                  title="Add new category"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <Plus className="w-3 h-3" />
                </Button>
              </>
            )}
          </div>
        </div>

        {showNewCategoryInput && (
          <div className="flex gap-1">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCategory();
                if (e.key === "Escape") {
                  setNewCategoryName("");
                  setShowNewCategoryInput(false);
                }
              }}
              placeholder="Category name..."
              className="h-7 text-xs bg-transparent border-border-default"
            />
            <Button size="sm" className="h-7 px-2" onClick={handleAddCategory}>
              Add
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {allCategories.map((category) => {
            const categoryItems = itemsByCategory[category.name] || [];
            const isCollapsed = collapsedCategories.has(category.name);
            const isDeletable = !DEFAULT_CATEGORY_NAMES.includes(category.name);

            return (
              <div
                key={category.name}
                className={`space-y-1 rounded-lg transition-all ${
                  dragOverCategory === category.name
                    ? "bg-brand-primary/10 ring-2 ring-brand-primary/50"
                    : ""
                }`}
                onDragOver={handleDragOver}
                onDragEnter={() => handleCategoryDragEnter(category.name)}
                onDragLeave={handleCategoryDragLeave}
                onDrop={(e) => handleDrop(e, category.name)}
              >
                <div className="flex items-center gap-1">
                  {isSelectionMode && categoryItems.length > 0 && (
                    <Checkbox
                      checked={
                        categoryItems.length > 0 &&
                        categoryItems.every((item) => selectedIds.has(item.id))
                      }
                      onCheckedChange={() =>
                        toggleCategorySelection(category.name)
                      }
                      className="h-3.5 w-3.5 ml-1 border-border-default data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 p-0 px-1 text-text-muted hover:text-white flex-1 justify-start"
                    onClick={() => toggleCategory(category.name)}
                  >
                    {isCollapsed ? (
                      <>
                        <ChevronRight className="w-3 h-3 mr-1" />
                        <Folder className="w-3 h-3 mr-1" />
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3 mr-1" />
                        <FolderOpen className="w-3 h-3 mr-1" />
                      </>
                    )}
                    <span className="text-xs font-medium">
                      {category.name} ({categoryItems.length})
                    </span>
                    {category.automationEnabled && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Play className="w-2.5 h-2.5 ml-1 text-brand-success" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Available for runner automation</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </Button>
                  <div className="flex items-center gap-1">
                    {/* Create sequential workflow button */}
                    {!isSelectionMode && onCreateSequential && (
                      <Button
                        size="sm"
                        className="h-6 w-6 p-0 bg-brand-primary hover:bg-brand-primary/80 text-black"
                        onClick={() => onCreateSequential(category.name)}
                        title={`Create sequential workflow in ${category.name}`}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    )}
                    {/* Create graph workflow button */}
                    {!isSelectionMode && onCreateGraph && (
                      <Button
                        size="sm"
                        className="h-6 w-6 p-0 bg-brand-success hover:bg-brand-success/80 text-black"
                        onClick={() => onCreateGraph(category.name)}
                        title={`Create graph workflow in ${category.name}`}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    )}
                    {/* Toggle automation availability button */}
                    {!isSelectionMode && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 w-6 p-0 ${
                              category.automationEnabled
                                ? "text-brand-success hover:text-brand-success/80"
                                : "text-text-muted hover:text-text-secondary"
                            }`}
                            onClick={() => handleToggleAutomation(category)}
                            title={
                              category.automationEnabled
                                ? "Remove from runner automation"
                                : "Add to runner automation"
                            }
                          >
                            <Play className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {category.automationEnabled
                              ? "Click to remove from runner automation"
                              : "Click to make available for runner automation"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {!isSelectionMode && (
                      <>
                        {isDeletable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                            onClick={() => handleDeleteCategory(category.name)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        ) : (
                          <div className="h-6 w-6" />
                        )}
                      </>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="ml-4 space-y-1">
                    {categoryItems.length === 0 ? (
                      <div className="text-xs text-text-muted italic py-2">
                        Drop workflows here or use + buttons above
                      </div>
                    ) : (
                      categoryItems.map(libraryItem)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DeleteCategoryDialog
          open={deleteCategoryDialog.open}
          categoryName={deleteCategoryDialog.category}
          processCount={deleteCategoryDialog.workflows.length}
          processNames={deleteCategoryDialog.workflows.map((w) => w.name)}
          onClose={() =>
            setDeleteCategoryDialog({
              open: false,
              category: "",
              workflows: [],
            })
          }
          onDeleteAll={handleDeleteAllWorkflows}
          onMoveToMain={handleMoveToMain}
        />

        <DeleteWorkflowDialog
          open={deleteItemDialog.open}
          workflowName={
            deleteItemDialog.item ? getItemName(deleteItemDialog.item) : ""
          }
          onClose={() => setDeleteItemDialog({ open: false, item: null })}
          onConfirm={handleConfirmDelete}
        />

        <BatchDeleteWorkflowsDialog
          open={batchDeleteDialog}
          workflowNames={getSelectedItems().map((item) => getItemName(item))}
          onClose={() => setBatchDeleteDialog(false)}
          onConfirm={handleConfirmBatchDelete}
        />
      </div>
    </TooltipProvider>
  );
}
