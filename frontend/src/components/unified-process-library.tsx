"use client";

import { useState, DragEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play,
  Trash2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Workflow as WorkflowIcon,
  List,
  ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { DeleteCategoryDialog } from "@/components/delete-category-dialog";
import { DeleteWorkflowDialog } from "@/components/delete-process-dialog";
import type { Workflow } from "@/lib/action-schema/action-types";

// LibraryItem is now just Workflow - sequential workflows are linear graphs
type LibraryItem = Workflow;

interface UnifiedProcessLibraryProps {
  selectedItem: LibraryItem | null;
  onSelectItem: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onUpdateWorkflow?: (workflow: Workflow) => void;
  onCreateSequential?: (category: string) => void;
  onCreateGraph?: (category: string) => void;
  onConvertItem?: (item: LibraryItem) => void;
}

export function UnifiedProcessLibrary({
  selectedItem,
  onSelectItem,
  onDeleteItem,
  onUpdateWorkflow,
  onCreateSequential,
  onCreateGraph,
  onConvertItem,
}: UnifiedProcessLibraryProps) {
  const { workflows, transitions, categories, addCategory, deleteCategory } =
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

  // Get all unique categories from workflows
  const workflowCategories = [
    ...new Set(workflows.map((w) => w.category || "Main")),
  ];

  // Combine all categories
  const allCategories = [...new Set([...categories, ...workflowCategories])];

  // Group workflows by category
  const itemsByCategory = allCategories.reduce(
    (acc, category) => {
      acc[category] = workflows.filter(
        (w) => (w.category || "Main") === category
      );
      return acc;
    },
    {} as Record<string, LibraryItem[]>
  );

  const getItemUsageCount = (item: LibraryItem) => {
    // Count how many transitions reference this workflow
    return transitions.filter(
      (t) => t.workflows && t.workflows.includes(item.id)
    ).length;
  };

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
    if (newCategoryName && !allCategories.includes(newCategoryName)) {
      addCategory(newCategoryName);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
      toast.success("Category created", {
        description: `"${newCategoryName}" has been added.`,
      });
    }
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

  const renderItem = (item: LibraryItem) => {
    const usageCount = getItemUsageCount(item);
    const isLinear = isLinearWorkflow(item);
    const isDraggable = true; // All workflows can be dragged

    return (
      <Card
        key={item.id}
        draggable={isDraggable}
        onDragStart={(e) => handleDragStart(e, item)}
        onDragEnd={handleDragEnd}
        className={`cursor-pointer transition-all hover:border-[#00D9FF]/50 !py-0 !gap-0 ${
          isItemSelected(item)
            ? isLinear
              ? "border-[#00D9FF] bg-[#00D9FF]/10"
              : "border-[#00FF88] bg-[#00FF88]/10"
            : "border-gray-700 bg-[#27272A]"
        } ${draggedItem?.id === item.id ? "opacity-50" : ""}`}
        onClick={() => onSelectItem(item)}
      >
        <CardContent className="py-1 px-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {isLinear ? (
                <List className="w-3 h-3 text-[#00D9FF] flex-shrink-0" />
              ) : (
                <WorkflowIcon className="w-3 h-3 text-[#00FF88] flex-shrink-0" />
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
                  !isLinear ? "bg-[#00FF88]/20 text-[#00FF88]" : ""
                }`}
              >
                {getItemActionCount(item)}
              </Badge>
              {onConvertItem && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-gray-400 hover:text-[#00FF88]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConvertItem(item);
                  }}
                  title={!isLinear ? "View as sequential" : "View as graph"}
                >
                  <ArrowRightLeft className="w-2.5 h-2.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-gray-400 hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(item);
                }}
              >
                <Trash2 className="w-2.5 h-2.5" />
              </Button>
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
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
            Automation Library
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-gray-400 hover:text-[#00D9FF] flex items-center gap-1"
            onClick={() => setShowNewCategoryInput(true)}
            title="Add new category"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <Plus className="w-3 h-3" />
          </Button>
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
              className="h-7 text-xs bg-transparent border-gray-700"
              autoFocus
            />
            <Button size="sm" className="h-7 px-2" onClick={handleAddCategory}>
              Add
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {allCategories.map((category) => {
            const categoryItems = itemsByCategory[category] || [];
            const isCollapsed = collapsedCategories.has(category);
            const isDeletable =
              category !== "Main" && category !== "Transitions";

            return (
              <div
                key={category}
                className={`space-y-1 rounded-lg transition-all ${
                  dragOverCategory === category
                    ? "bg-[#00D9FF]/10 ring-2 ring-[#00D9FF]/50"
                    : ""
                }`}
                onDragOver={handleDragOver}
                onDragEnter={() => handleCategoryDragEnter(category)}
                onDragLeave={handleCategoryDragLeave}
                onDrop={(e) => handleDrop(e, category)}
              >
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 p-0 px-1 text-gray-400 hover:text-white flex-1 justify-start"
                    onClick={() => toggleCategory(category)}
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
                      {category} ({categoryItems.length})
                    </span>
                  </Button>
                  <div className="flex items-center gap-1">
                    {/* Create sequential workflow button */}
                    {onCreateSequential && (
                      <Button
                        size="sm"
                        className="h-6 w-6 p-0 bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                        onClick={() => onCreateSequential(category)}
                        title={`Create sequential workflow in ${category}`}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    )}
                    {/* Create graph workflow button */}
                    {onCreateGraph && (
                      <Button
                        size="sm"
                        className="h-6 w-6 p-0 bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
                        onClick={() => onCreateGraph(category)}
                        title={`Create graph workflow in ${category}`}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    )}
                    <div className="w-5" />
                    {isDeletable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
                        onClick={() => handleDeleteCategory(category)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    ) : (
                      <div className="h-6 w-6" />
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="ml-4 space-y-1">
                    {categoryItems.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-2">
                        Drop workflows here or use + buttons above
                      </div>
                    ) : (
                      categoryItems.map(renderItem)
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
      </div>
    </TooltipProvider>
  );
}
