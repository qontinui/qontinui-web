import { useState, DragEvent } from "react";
import { toast } from "sonner";
import { useAutomation, type Category } from "@/contexts/automation-context";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { LibraryItem } from "../types";

export function useCategoryManagement(
  onDeleteItem: (item: LibraryItem) => void,
  onUpdateWorkflow?: (workflow: Workflow) => void
) {
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

  // Get all unique category names from workflows
  const workflowCategoryNames = [
    ...new Set(workflows.map((w) => w.category || "Main")),
  ];

  // Combine all categories - merge category objects with workflow categories
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

  return {
    workflows,
    allCategories,
    itemsByCategory,
    collapsedCategories,
    newCategoryName,
    setNewCategoryName,
    showNewCategoryInput,
    setShowNewCategoryInput,
    draggedItem,
    dragOverCategory,
    deleteCategoryDialog,
    setDeleteCategoryDialog,
    toggleCategory,
    handleAddCategory,
    handleToggleAutomation,
    handleDeleteCategory,
    handleDeleteAllWorkflows,
    handleMoveToMain,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleCategoryDragEnter,
    handleCategoryDragLeave,
    handleDrop,
  };
}
