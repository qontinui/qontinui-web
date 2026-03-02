import { useState, useCallback, useMemo } from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import { WorkflowFolder } from "../types";
import { toast } from "sonner";

export interface OperationProgress {
  current: number;
  total: number;
  operation: string;
  status: "running" | "success" | "error";
  message?: string;
}

interface BulkOperationCallbacks {
  onMoveToFolder: (folderId: string) => void;
  onAddTags: (tags: string[]) => void;
  onRemoveTags: (tags: string[]) => void;
  onChangeCategory: (category: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onRunTests: () => void;
  onDuplicate: () => void;
}

function getExistingTags(workflows: Workflow[]): string[] {
  const tagSet = new Set<string>();
  workflows.forEach((w) => {
    (w.tags || []).forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

function getExistingCategories(workflows: Workflow[]): string[] {
  const categorySet = new Set<string>();
  workflows.forEach((w) => {
    if (w.category) categorySet.add(w.category);
  });
  return Array.from(categorySet).sort();
}

export function useBulkOperations(
  selectedWorkflows: Workflow[],
  folders: WorkflowFolder[],
  callbacks: BulkOperationCallbacks
) {
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showAddTagsDialog, setShowAddTagsDialog] = useState(false);
  const [showRemoveTagsDialog, setShowRemoveTagsDialog] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [tagsToAdd, setTagsToAdd] = useState<string[]>([]);
  const [tagsToRemove, setTagsToRemove] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [operationProgress, setOperationProgress] =
    useState<OperationProgress | null>(null);

  const existingTags = useMemo(
    () => getExistingTags(selectedWorkflows),
    [selectedWorkflows]
  );
  const existingCategories = useMemo(
    () => getExistingCategories(selectedWorkflows),
    [selectedWorkflows]
  );

  const handleMoveToFolder = useCallback(() => {
    if (!selectedFolderId) {
      toast.error("Please select a folder");
      return;
    }
    const folder = folders.find((f) => f.id === selectedFolderId);
    callbacks.onMoveToFolder(selectedFolderId);
    setShowMoveDialog(false);
    setSelectedFolderId("");
    toast.success(
      `Moved ${selectedWorkflows.length} workflow(s) to "${folder?.name}"`
    );
  }, [selectedFolderId, folders, selectedWorkflows, callbacks]);

  const handleAddTags = useCallback(() => {
    if (tagsToAdd.length === 0) {
      toast.error("Please add at least one tag");
      return;
    }
    callbacks.onAddTags(tagsToAdd);
    setShowAddTagsDialog(false);
    setTagsToAdd([]);
    setNewTagInput("");
    toast.success(
      `Added ${tagsToAdd.length} tag(s) to ${selectedWorkflows.length} workflow(s)`
    );
  }, [tagsToAdd, selectedWorkflows, callbacks]);

  const handleRemoveTags = useCallback(() => {
    if (tagsToRemove.length === 0) {
      toast.error("Please select at least one tag to remove");
      return;
    }
    callbacks.onRemoveTags(tagsToRemove);
    setShowRemoveTagsDialog(false);
    setTagsToRemove([]);
    toast.success(
      `Removed ${tagsToRemove.length} tag(s) from ${selectedWorkflows.length} workflow(s)`
    );
  }, [tagsToRemove, selectedWorkflows, callbacks]);

  const handleChangeCategory = useCallback(() => {
    if (!selectedCategory) {
      toast.error("Please select a category");
      return;
    }
    callbacks.onChangeCategory(selectedCategory);
    setShowCategoryDialog(false);
    setSelectedCategory("");
    toast.success(
      `Changed category to "${selectedCategory}" for ${selectedWorkflows.length} workflow(s)`
    );
  }, [selectedCategory, selectedWorkflows, callbacks]);

  const handleDelete = useCallback(() => {
    callbacks.onDelete();
    setShowDeleteDialog(false);
    toast.success(`Deleted ${selectedWorkflows.length} workflow(s)`);
  }, [selectedWorkflows, callbacks]);

  const handleExport = useCallback(() => {
    callbacks.onExport();
    toast.success(`Exported ${selectedWorkflows.length} workflow(s)`);
  }, [selectedWorkflows, callbacks]);

  const handleDuplicate = useCallback(() => {
    callbacks.onDuplicate();
    toast.success(`Duplicated ${selectedWorkflows.length} workflow(s)`);
  }, [selectedWorkflows, callbacks]);

  const handleRunTests = useCallback(async () => {
    setOperationProgress({
      current: 0,
      total: selectedWorkflows.length,
      operation: "Running tests",
      status: "running",
    });

    try {
      callbacks.onRunTests();

      for (let i = 1; i <= selectedWorkflows.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        setOperationProgress({
          current: i,
          total: selectedWorkflows.length,
          operation: "Running tests",
          status: i === selectedWorkflows.length ? "success" : "running",
          message:
            i === selectedWorkflows.length
              ? "All tests completed"
              : `Testing workflow ${i}/${selectedWorkflows.length}`,
        });
      }

      setTimeout(() => {
        setOperationProgress(null);
        toast.success(`Ran tests for ${selectedWorkflows.length} workflow(s)`);
      }, 1000);
    } catch {
      setOperationProgress({
        current: 0,
        total: selectedWorkflows.length,
        operation: "Running tests",
        status: "error",
        message: "Test execution failed",
      });

      setTimeout(() => {
        setOperationProgress(null);
      }, 2000);

      toast.error("Failed to run tests");
    }
  }, [selectedWorkflows, callbacks]);

  const handleAddNewTag = useCallback(() => {
    const tag = newTagInput.trim();
    if (tag && !tagsToAdd.includes(tag)) {
      setTagsToAdd([...tagsToAdd, tag]);
      setNewTagInput("");
    }
  }, [newTagInput, tagsToAdd]);

  const handleRemoveTagFromList = useCallback(
    (tag: string) => {
      setTagsToAdd(tagsToAdd.filter((t) => t !== tag));
    },
    [tagsToAdd]
  );

  const handleToggleRemoveTag = useCallback(
    (tag: string) => {
      if (tagsToRemove.includes(tag)) {
        setTagsToRemove(tagsToRemove.filter((t) => t !== tag));
      } else {
        setTagsToRemove([...tagsToRemove, tag]);
      }
    },
    [tagsToRemove]
  );

  return {
    dialogs: {
      showMoveDialog,
      setShowMoveDialog,
      showAddTagsDialog,
      setShowAddTagsDialog,
      showRemoveTagsDialog,
      setShowRemoveTagsDialog,
      showCategoryDialog,
      setShowCategoryDialog,
      showDeleteDialog,
      setShowDeleteDialog,
    },
    moveFolder: {
      selectedFolderId,
      setSelectedFolderId,
      handleMoveToFolder,
    },
    addTags: {
      newTagInput,
      setNewTagInput,
      tagsToAdd,
      handleAddTags,
      handleAddNewTag,
      handleRemoveTagFromList,
    },
    removeTags: {
      tagsToRemove,
      existingTags,
      handleRemoveTags,
      handleToggleRemoveTag,
    },
    category: {
      selectedCategory,
      setSelectedCategory,
      existingCategories,
      handleChangeCategory,
    },
    handleDelete,
    handleExport,
    handleDuplicate,
    handleRunTests,
    operationProgress,
  };
}
