import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { LibraryItem } from "../types";
import type { Workflow } from "@/lib/action-schema/action-types";

export function useSelectionMode(
  workflows: Workflow[],
  itemsByCategory: Record<string, LibraryItem[]>,
  onDeleteItem: (item: LibraryItem) => void,
  onDeleteItems?: (items: LibraryItem[]) => void
) {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialog, setBatchDeleteDialog] = useState(false);

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
          categoryIds.forEach((id) => next.delete(id));
        } else {
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
      itemsToDelete.forEach((item) => onDeleteItem(item));
      toast.success(
        `${itemsToDelete.length} workflow${itemsToDelete.length !== 1 ? "s" : ""} deleted`
      );
    }
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    setBatchDeleteDialog(false);
  }, [getSelectedItems, onDeleteItems, onDeleteItem]);

  return {
    isSelectionMode,
    selectedIds,
    batchDeleteDialog,
    setBatchDeleteDialog,
    toggleSelectionMode,
    toggleItemSelection,
    toggleCategorySelection,
    getSelectedItems,
    handleBatchDelete,
    handleConfirmBatchDelete,
  };
}
