"use client";

import { DeleteCategoryDialog } from "@/components/delete-category-dialog";
import { DeleteConfirmDialog } from "@/components/common/_components/DeleteConfirmDialog";
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
  const batchNames = selectedItems.map((item) => getItemName(item));

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

      <DeleteConfirmDialog
        open={deleteItemDialog.open}
        onOpenChange={() => onCloseItemDialog()}
        onConfirm={onConfirmDelete}
        title="Delete Workflow"
        itemNames={
          deleteItemDialog.item
            ? [getItemName(deleteItemDialog.item)]
            : undefined
        }
      />

      <DeleteConfirmDialog
        open={batchDeleteDialog}
        onOpenChange={() => onCloseBatchDialog()}
        onConfirm={onConfirmBatchDelete}
        title={`Delete ${batchNames.length} Workflow${batchNames.length !== 1 ? "s" : ""}`}
        itemNames={batchNames}
        count={batchNames.length}
      />
    </>
  );
}
