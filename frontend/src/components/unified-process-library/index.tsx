"use client";

import { useState } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { UnifiedProcessLibraryProps, LibraryItem } from "./types";
import { getItemName, isLinearWorkflow } from "./utils";
import { useCategoryManagement } from "./_hooks/use-category-management";
import { useSelectionMode } from "./_hooks/use-selection-mode";
import { LibraryHeader } from "./_components/LibraryHeader";
import { CategorySection } from "./_components/CategorySection";
import { DeleteDialogs } from "./_components/DeleteDialogs";

export type { LibraryItem, UnifiedProcessLibraryProps };

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
  const categoryMgmt = useCategoryManagement(onDeleteItem, onUpdateWorkflow);
  const selectionMode = useSelectionMode(
    categoryMgmt.workflows,
    categoryMgmt.itemsByCategory,
    onDeleteItem,
    onDeleteItems
  );

  const [deleteItemDialog, setDeleteItemDialog] = useState<{
    open: boolean;
    item: LibraryItem | null;
  }>({ open: false, item: null });

  const handleDelete = (item: LibraryItem) => {
    setDeleteItemDialog({ open: true, item });
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

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <LibraryHeader
          isSelectionMode={selectionMode.isSelectionMode}
          selectedCount={selectionMode.selectedIds.size}
          showNewCategoryInput={categoryMgmt.showNewCategoryInput}
          newCategoryName={categoryMgmt.newCategoryName}
          onToggleSelectionMode={selectionMode.toggleSelectionMode}
          onBatchDelete={selectionMode.handleBatchDelete}
          onShowNewCategoryInput={() =>
            categoryMgmt.setShowNewCategoryInput(true)
          }
          onNewCategoryNameChange={categoryMgmt.setNewCategoryName}
          onAddCategory={categoryMgmt.handleAddCategory}
          onCancelNewCategory={() => {
            categoryMgmt.setNewCategoryName("");
            categoryMgmt.setShowNewCategoryInput(false);
          }}
        />

        <div className="space-y-2">
          {categoryMgmt.allCategories.map((category) => {
            const categoryItems =
              categoryMgmt.itemsByCategory[category.name] || [];
            const isCollapsed = categoryMgmt.collapsedCategories.has(
              category.name
            );

            return (
              <CategorySection
                key={category.name}
                category={category}
                categoryItems={categoryItems}
                isCollapsed={isCollapsed}
                isSelectionMode={selectionMode.isSelectionMode}
                selectedIds={selectionMode.selectedIds}
                selectedItem={selectedItem}
                draggedItem={categoryMgmt.draggedItem}
                dragOverCategory={categoryMgmt.dragOverCategory}
                onToggleCategory={categoryMgmt.toggleCategory}
                onToggleCategorySelection={
                  selectionMode.toggleCategorySelection
                }
                onToggleAutomation={categoryMgmt.handleToggleAutomation}
                onDeleteCategory={categoryMgmt.handleDeleteCategory}
                onCreateSequential={onCreateSequential}
                onCreateGraph={onCreateGraph}
                onSelectItem={onSelectItem}
                onToggleItemSelection={selectionMode.toggleItemSelection}
                onDeleteItem={handleDelete}
                onConvertItem={onConvertItem}
                onDragStart={categoryMgmt.handleDragStart}
                onDragEnd={categoryMgmt.handleDragEnd}
                onDragOver={categoryMgmt.handleDragOver}
                onDragEnter={categoryMgmt.handleCategoryDragEnter}
                onDragLeave={categoryMgmt.handleCategoryDragLeave}
                onDrop={categoryMgmt.handleDrop}
              />
            );
          })}
        </div>

        <DeleteDialogs
          deleteCategoryDialog={categoryMgmt.deleteCategoryDialog}
          deleteItemDialog={deleteItemDialog}
          batchDeleteDialog={selectionMode.batchDeleteDialog}
          selectedItems={selectionMode.getSelectedItems()}
          onCloseCategoryDialog={() =>
            categoryMgmt.setDeleteCategoryDialog({
              open: false,
              category: "",
              workflows: [],
            })
          }
          onDeleteAllWorkflows={categoryMgmt.handleDeleteAllWorkflows}
          onMoveToMain={categoryMgmt.handleMoveToMain}
          onCloseItemDialog={() =>
            setDeleteItemDialog({ open: false, item: null })
          }
          onConfirmDelete={handleConfirmDelete}
          onCloseBatchDialog={() => selectionMode.setBatchDeleteDialog(false)}
          onConfirmBatchDelete={selectionMode.handleConfirmBatchDelete}
        />
      </div>
    </TooltipProvider>
  );
}
