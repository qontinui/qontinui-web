import { useEffect } from "react";

interface KeyboardShortcutOptions {
  open: boolean;
  bulkSelectMode: boolean;
  selectedCount: number;
  onToggleSelectAll: () => void;
  onBulkDelete: () => void;
  onShowAdvancedSearch: () => void;
  onExitBulkSelect: () => void;
  onClose: () => void;
}

export function useKeyboardShortcuts({
  open,
  bulkSelectMode,
  selectedCount,
  onToggleSelectAll,
  onBulkDelete,
  onShowAdvancedSearch,
  onExitBulkSelect,
  onClose,
}: KeyboardShortcutOptions) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        onShowAdvancedSearch();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        onToggleSelectAll();
      }
      if (e.key === "Delete" && selectedCount > 0) {
        e.preventDefault();
        onBulkDelete();
      }
      if (e.key === "Escape") {
        if (bulkSelectMode) {
          onExitBulkSelect();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    bulkSelectMode,
    selectedCount,
    onToggleSelectAll,
    onBulkDelete,
    onShowAdvancedSearch,
    onExitBulkSelect,
    onClose,
  ]);
}
