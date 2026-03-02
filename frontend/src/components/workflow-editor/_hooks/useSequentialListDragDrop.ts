/**
 * Custom hook encapsulating drag-and-drop state and handlers
 * for the Sequential List View.
 */

import { useState } from "react";

interface UseSequentialListDragDropOptions {
  editable: boolean;
  onActionReorder?: (fromIndex: number, toIndex: number) => void;
}

export function useSequentialListDragDrop({
  editable,
  onActionReorder,
}: UseSequentialListDragDropOptions) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!editable) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!editable) return;
    e.preventDefault();
    setDropIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    if (!editable || draggedIndex === null) return;
    e.preventDefault();

    if (draggedIndex !== index && onActionReorder) {
      onActionReorder(draggedIndex, index);
    }

    setDraggedIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

  return {
    draggedIndex,
    dropIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  };
}
