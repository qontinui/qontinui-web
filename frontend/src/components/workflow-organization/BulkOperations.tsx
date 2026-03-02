import React from "react";
import { Workflow } from "../../lib/action-schema/action-types";
import { WorkflowFolder } from "./types";
import { useBulkOperations } from "./_hooks/useBulkOperations";
import { BulkToolbar } from "./_components/BulkToolbar";
import { BulkProgressIndicator } from "./_components/BulkProgressIndicator";
import { MoveToFolderDialog } from "./_components/MoveToFolderDialog";
import { AddTagsDialog } from "./_components/AddTagsDialog";
import { RemoveTagsDialog } from "./_components/RemoveTagsDialog";
import { ChangeCategoryDialog } from "./_components/ChangeCategoryDialog";
import { DeleteConfirmDialog } from "@/components/common/_components/DeleteConfirmDialog";

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
  const bulk = useBulkOperations(selectedWorkflows, folders, {
    onMoveToFolder,
    onAddTags,
    onRemoveTags,
    onChangeCategory,
    onDelete,
    onExport,
    onRunTests,
    onDuplicate,
  });

  if (selectedWorkflows.length === 0) {
    return null;
  }

  const workflowCount = selectedWorkflows.length;

  return (
    <>
      <BulkToolbar
        selectedCount={workflowCount}
        onClearSelection={onClearSelection}
        onMoveClick={() => bulk.dialogs.setShowMoveDialog(true)}
        onAddTagsClick={() => bulk.dialogs.setShowAddTagsDialog(true)}
        onRemoveTagsClick={() => bulk.dialogs.setShowRemoveTagsDialog(true)}
        onChangeCategoryClick={() => bulk.dialogs.setShowCategoryDialog(true)}
        onDuplicate={bulk.handleDuplicate}
        onExport={bulk.handleExport}
        onRunTests={bulk.handleRunTests}
        onDeleteClick={() => bulk.dialogs.setShowDeleteDialog(true)}
        className={className}
      />

      {bulk.operationProgress && (
        <BulkProgressIndicator progress={bulk.operationProgress} />
      )}

      <MoveToFolderDialog
        open={bulk.dialogs.showMoveDialog}
        onOpenChange={bulk.dialogs.setShowMoveDialog}
        folders={folders}
        selectedFolderId={bulk.moveFolder.selectedFolderId}
        onFolderChange={bulk.moveFolder.setSelectedFolderId}
        onConfirm={bulk.moveFolder.handleMoveToFolder}
        workflowCount={workflowCount}
      />

      <AddTagsDialog
        open={bulk.dialogs.showAddTagsDialog}
        onOpenChange={bulk.dialogs.setShowAddTagsDialog}
        newTagInput={bulk.addTags.newTagInput}
        onNewTagInputChange={bulk.addTags.setNewTagInput}
        tagsToAdd={bulk.addTags.tagsToAdd}
        onAddNewTag={bulk.addTags.handleAddNewTag}
        onRemoveTagFromList={bulk.addTags.handleRemoveTagFromList}
        onConfirm={bulk.addTags.handleAddTags}
        workflowCount={workflowCount}
      />

      <RemoveTagsDialog
        open={bulk.dialogs.showRemoveTagsDialog}
        onOpenChange={bulk.dialogs.setShowRemoveTagsDialog}
        existingTags={bulk.removeTags.existingTags}
        tagsToRemove={bulk.removeTags.tagsToRemove}
        onToggleRemoveTag={bulk.removeTags.handleToggleRemoveTag}
        onConfirm={bulk.removeTags.handleRemoveTags}
        workflowCount={workflowCount}
      />

      <ChangeCategoryDialog
        open={bulk.dialogs.showCategoryDialog}
        onOpenChange={bulk.dialogs.setShowCategoryDialog}
        selectedCategory={bulk.category.selectedCategory}
        onCategoryChange={bulk.category.setSelectedCategory}
        existingCategories={bulk.category.existingCategories}
        onConfirm={bulk.category.handleChangeCategory}
        workflowCount={workflowCount}
      />

      <DeleteConfirmDialog
        open={bulk.dialogs.showDeleteDialog}
        onOpenChange={bulk.dialogs.setShowDeleteDialog}
        onConfirm={bulk.handleDelete}
        title="Delete Workflows"
        count={workflowCount}
        description={`Are you sure you want to delete ${workflowCount} workflow(s)? This action cannot be undone.`}
      />
    </>
  );
}
