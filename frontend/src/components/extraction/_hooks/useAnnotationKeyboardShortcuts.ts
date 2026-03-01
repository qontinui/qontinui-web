"use client";

import { useEffect } from "react";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

interface UseAnnotationKeyboardShortcutsOptions {
  onSave: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onShowShortcuts: () => void;
}

export function useAnnotationKeyboardShortcuts({
  onSave,
  onCopy,
  onCut,
  onPaste,
  onShowShortcuts,
}: UseAnnotationKeyboardShortcutsOptions) {
  const {
    hasUnsavedChanges,
    extractionId,
    hasSelection,
    clipboard,
    grid,
    selectAll,
    deselectAll,
    setActiveTool,
    setGridEnabled,
    canUndo,
    canRedo,
    undo,
    redo,
    selectedElementIds,
    deleteElements,
  } = useExtractionAnnotationStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+S - Save
      if (isCtrlOrCmd && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges && extractionId) {
          onSave();
        }
        return;
      }

      // Ctrl+Z - Undo
      if (isCtrlOrCmd && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
        }
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z - Redo
      if (isCtrlOrCmd && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (canRedo()) {
          redo();
        }
        return;
      }

      // Ctrl+C - Copy
      if (isCtrlOrCmd && e.key === "c" && !e.shiftKey) {
        if (hasSelection()) {
          e.preventDefault();
          onCopy();
        }
        return;
      }

      // Ctrl+X - Cut
      if (isCtrlOrCmd && e.key === "x") {
        if (hasSelection()) {
          e.preventDefault();
          onCut();
        }
        return;
      }

      // Ctrl+V - Paste
      if (isCtrlOrCmd && e.key === "v") {
        if (clipboard && clipboard.elements.length > 0) {
          e.preventDefault();
          onPaste();
        }
        return;
      }

      // Ctrl+A - Select All
      if (isCtrlOrCmd && e.key === "a") {
        e.preventDefault();
        selectAll();
        return;
      }

      // Escape - Deselect
      if (e.key === "Escape") {
        deselectAll();
        return;
      }

      // ? - Show keyboard shortcuts
      if (e.key === "?") {
        e.preventDefault();
        onShowShortcuts();
        return;
      }

      // Delete key - Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          deleteElements(selectedElementIds);
        }
        return;
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case "s":
          setActiveTool("select");
          break;
        case "d":
          setActiveTool("draw");
          break;
        case "x":
          setActiveTool("delete");
          break;
        case "p":
          setActiveTool("pan");
          break;
        case "g":
          if (isCtrlOrCmd) {
            e.preventDefault();
            setGridEnabled(!grid.enabled);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSave, onCopy, onCut, onPaste are intentionally excluded to avoid re-registering on every render
  }, [
    hasUnsavedChanges,
    extractionId,
    hasSelection,
    clipboard,
    grid.enabled,
    selectAll,
    deselectAll,
    setActiveTool,
    setGridEnabled,
    canUndo,
    canRedo,
    undo,
    redo,
    selectedElementIds,
    deleteElements,
  ]);
}
