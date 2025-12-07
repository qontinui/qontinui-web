/**
 * Bulk Operations Component
 *
 * Bulk operations toolbar for managing multiple workflows at once:
 * - Move to folder
 * - Add/remove tags
 * - Change category
 * - Delete
 * - Export
 * - Duplicate
 * - Run tests
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  X,
  Folder,
  Tag,
  Trash2,
  Download,
  Copy,
  PlayCircle,
  MoreHorizontal,
  FolderOpen,
  TagIcon,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Workflow } from "../../lib/action-schema/action-types";
import { WorkflowFolder } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../../lib/utils";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export interface BulkOperationsProps {
  selectedWorkflows: Workflow[];
  folders: WorkflowFolder[];
  onClearSelection: () => void;
  onMoveToFolder: (folderId: string) => void;
  onAddTags: (tags: string[]) => void;
  onRemoveTags: (tags: string[]) => void;
  onChangeCategory: (category: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onRunTests: () => void;
  onDuplicate: () => void;
  className?: string;
}

interface OperationProgress {
  current: number;
  total: number;
  operation: string;
  status: "running" | "success" | "error";
  message?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all unique tags from selected workflows
 */
function getExistingTags(workflows: Workflow[]): string[] {
  const tagSet = new Set<string>();
  workflows.forEach((w) => {
    (w.tags || []).forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

/**
 * Get all unique categories from selected workflows
 */
function getExistingCategories(workflows: Workflow[]): string[] {
  const categorySet = new Set<string>();
  workflows.forEach((w) => {
    if (w.category) categorySet.add(w.category);
  });
  return Array.from(categorySet).sort();
}

// ============================================================================
// Main Component
// ============================================================================

export function BulkOperations({
  selectedWorkflows,
  folders,
  onClearSelection,
  onMoveToFolder,
  onAddTags,
  onRemoveTags,
  onChangeCategory,
  onDelete,
  onExport,
  onRunTests,
  onDuplicate,
  className,
}: BulkOperationsProps) {
  // State
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

  // Extract existing tags and categories
  const existingTags = useMemo(
    () => getExistingTags(selectedWorkflows),
    [selectedWorkflows]
  );
  const existingCategories = useMemo(
    () => getExistingCategories(selectedWorkflows),
    [selectedWorkflows]
  );

  // Handlers
  const handleMoveToFolder = useCallback(() => {
    if (!selectedFolderId) {
      toast.error("Please select a folder");
      return;
    }

    const folder = folders.find((f) => f.id === selectedFolderId);
    onMoveToFolder(selectedFolderId);
    setShowMoveDialog(false);
    setSelectedFolderId("");
    toast.success(
      `Moved ${selectedWorkflows.length} workflow(s) to "${folder?.name}"`
    );
  }, [selectedFolderId, folders, selectedWorkflows, onMoveToFolder]);

  const handleAddTags = useCallback(() => {
    if (tagsToAdd.length === 0) {
      toast.error("Please add at least one tag");
      return;
    }

    onAddTags(tagsToAdd);
    setShowAddTagsDialog(false);
    setTagsToAdd([]);
    setNewTagInput("");
    toast.success(
      `Added ${tagsToAdd.length} tag(s) to ${selectedWorkflows.length} workflow(s)`
    );
  }, [tagsToAdd, selectedWorkflows, onAddTags]);

  const handleRemoveTags = useCallback(() => {
    if (tagsToRemove.length === 0) {
      toast.error("Please select at least one tag to remove");
      return;
    }

    onRemoveTags(tagsToRemove);
    setShowRemoveTagsDialog(false);
    setTagsToRemove([]);
    toast.success(
      `Removed ${tagsToRemove.length} tag(s) from ${selectedWorkflows.length} workflow(s)`
    );
  }, [tagsToRemove, selectedWorkflows, onRemoveTags]);

  const handleChangeCategory = useCallback(() => {
    if (!selectedCategory) {
      toast.error("Please select a category");
      return;
    }

    onChangeCategory(selectedCategory);
    setShowCategoryDialog(false);
    setSelectedCategory("");
    toast.success(
      `Changed category to "${selectedCategory}" for ${selectedWorkflows.length} workflow(s)`
    );
  }, [selectedCategory, selectedWorkflows, onChangeCategory]);

  const handleDelete = useCallback(() => {
    onDelete();
    setShowDeleteDialog(false);
    toast.success(`Deleted ${selectedWorkflows.length} workflow(s)`);
  }, [selectedWorkflows, onDelete]);

  const handleExport = useCallback(() => {
    onExport();
    toast.success(`Exported ${selectedWorkflows.length} workflow(s)`);
  }, [selectedWorkflows, onExport]);

  const handleDuplicate = useCallback(() => {
    onDuplicate();
    toast.success(`Duplicated ${selectedWorkflows.length} workflow(s)`);
  }, [selectedWorkflows, onDuplicate]);

  const handleRunTests = useCallback(async () => {
    // Simulate progress for long operation
    setOperationProgress({
      current: 0,
      total: selectedWorkflows.length,
      operation: "Running tests",
      status: "running",
    });

    try {
      onRunTests();

      // Simulate progress updates
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
    } catch (error) {
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
  }, [selectedWorkflows, onRunTests]);

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

  if (selectedWorkflows.length === 0) {
    return null;
  }

  return (
    <>
      {/* Toolbar */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          className
        )}
      >
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Selection Info */}
            <div className="flex items-center gap-3">
              <Badge variant="default" className="text-sm px-3 py-1">
                {selectedWorkflows.length} selected
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                className="h-8"
              >
                <X className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </div>

            {/* Operations */}
            <div className="flex items-center gap-2">
              {/* Move to Folder */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMoveDialog(true)}
              >
                <Folder className="h-4 w-4 mr-2" />
                Move
              </Button>

              {/* Add Tags */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddTagsDialog(true)}
              >
                <Tag className="h-4 w-4 mr-2" />
                Add Tags
              </Button>

              {/* More Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4 mr-2" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setShowRemoveTagsDialog(true)}
                  >
                    <TagIcon className="h-4 w-4 mr-2" />
                    Remove Tags
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowCategoryDialog(true)}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Change Category
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDuplicate}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExport}>
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRunTests}>
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Run Tests
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Indicator */}
      {operationProgress && (
        <div className="fixed bottom-20 right-4 z-50 w-80 bg-card border rounded-lg shadow-lg p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">{operationProgress.operation}</span>
              {operationProgress.status === "running" && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {operationProgress.status === "success" && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              {operationProgress.status === "error" && (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
            </div>
            <Progress
              value={
                (operationProgress.current / operationProgress.total) * 100
              }
            />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {operationProgress.current} / {operationProgress.total}
              </span>
              {operationProgress.message && (
                <span>{operationProgress.message}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Move to Folder Dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Folder</DialogTitle>
            <DialogDescription>
              Select a folder to move {selectedWorkflows.length} workflow(s) to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-select">Folder</Label>
            <Select
              value={selectedFolderId}
              onValueChange={setSelectedFolderId}
            >
              <SelectTrigger id="folder-select" className="mt-2">
                <SelectValue placeholder="Select a folder..." />
              </SelectTrigger>
              <SelectContent>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleMoveToFolder}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Tags Dialog */}
      <Dialog open={showAddTagsDialog} onOpenChange={setShowAddTagsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tags</DialogTitle>
            <DialogDescription>
              Add tags to {selectedWorkflows.length} workflow(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag-input">New Tag</Label>
              <div className="flex gap-2">
                <Input
                  id="tag-input"
                  placeholder="Enter tag name..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddNewTag();
                    }
                  }}
                />
                <Button onClick={handleAddNewTag}>Add</Button>
              </div>
            </div>

            {tagsToAdd.length > 0 && (
              <div className="space-y-2">
                <Label>Tags to Add</Label>
                <div className="flex flex-wrap gap-2">
                  {tagsToAdd.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                      <button
                        onClick={() => handleRemoveTagFromList(tag)}
                        className="ml-2 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddTagsDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleAddTags} disabled={tagsToAdd.length === 0}>
              Add Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Tags Dialog */}
      <Dialog
        open={showRemoveTagsDialog}
        onOpenChange={setShowRemoveTagsDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Tags</DialogTitle>
            <DialogDescription>
              Select tags to remove from {selectedWorkflows.length} workflow(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {existingTags.length > 0 ? (
              <div className="space-y-2">
                <Label>Existing Tags</Label>
                <div className="space-y-1 max-h-60 overflow-y-auto border rounded-md p-2">
                  {existingTags.map((tag) => (
                    <label
                      key={tag}
                      className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={tagsToRemove.includes(tag)}
                        onChange={() => handleToggleRemoveTag(tag)}
                        className="rounded"
                      />
                      <span className="text-sm">{tag}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-4">
                No tags to remove
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRemoveTagsDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRemoveTags}
              disabled={tagsToRemove.length === 0}
              variant="destructive"
            >
              Remove Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Category Dialog */}
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Category</DialogTitle>
            <DialogDescription>
              Change category for {selectedWorkflows.length} workflow(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="category-select">Category</Label>
            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}
            >
              <SelectTrigger id="category-select" className="mt-2">
                <SelectValue placeholder="Select a category..." />
              </SelectTrigger>
              <SelectContent>
                {existingCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
                <SelectItem value="Main">Main</SelectItem>
                <SelectItem value="Utility">Utility</SelectItem>
                <SelectItem value="Testing">Testing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCategoryDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleChangeCategory}>Change Category</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Workflows
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedWorkflows.length}{" "}
              workflow(s)? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
