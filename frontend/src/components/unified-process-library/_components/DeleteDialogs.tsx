"use client";

import { DeleteCategoryDialog } from "@/components/delete-category-dialog";
import { DeleteWorkflowDialog } from "@/components/delete-process-dialog";
import { BatchDeleteWorkflowsDialog } from "@/components/batch-delete-workflows-dialog";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { LibraryItem } from "../types";
import { getItemName } from "../utils";

interface DeleteDialogsProps {
  deleteCategoryDialog: {
    open: boolean;
    category: string;
    workflows: Workflow[];
  };
  deleteItemDialog: {
    open: boolean;
    item: LibraryItem | null;
  };
  batchDeleteDialog: boolean;
  selectedItems: LibraryItem[];
  onCloseCategoryDialog: () => void;
  onDeleteAllWorkflows: () => void;
  onMoveToMain: () => void;
  onCloseItemDialog: () => void;
  onConfirmDelete: () => void;
  onCloseBatchDialog: () => void;
  onConfirmBatchDelete: () => void;
}

export function DeleteDialogs({
  deleteCategoryDialog,
  deleteItemDialog,
  batchDeleteDialog,
  selectedItems,
  onCloseCategoryDialog,
  onDeleteAllWorkflows,
  onMoveToMain,
  onCloseItemDialog,
  onConfirmDelete,
  onCloseBatchDialog,
  onConfirmBatchDelete,
}: DeleteDialogsProps) {
  return (
    <>
      <DeleteCategoryDialog
        open={deleteCategoryDialog.open}
        categoryName={deleteCategoryDialog.category}
        processCount={deleteCategoryDialog.workflows.length}
        processNames={deleteCategoryDialog.workflows.map((w) => w.name)}
        onClose={onCloseCategoryDialog}
        onDeleteAll={onDeleteAllWorkflows}
        onMoveToMain={onMoveToMain}
      />

      <DeleteWorkflowDialog
        open={deleteItemDialog.open}
        workflowName={
          deleteItemDialog.item ? getItemName(deleteItemDialog.item) : ""
        }
        onClose={onCloseItemDialog}
        onConfirm={onConfirmDelete}
      />

      <BatchDeleteWorkflowsDialog
        open={batchDeleteDialog}
        workflowNames={selectedItems.map((item) => getItemName(item))}
        onClose={onCloseBatchDialog}
        onConfirm={onConfirmBatchDelete}
      />
    </>
  );
}
