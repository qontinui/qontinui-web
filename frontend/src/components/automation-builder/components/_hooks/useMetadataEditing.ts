import { useState, useEffect, useCallback } from "react";
import type React from "react";
import {
  getSuggestedMode,
  type BuilderMode,
  type LibraryItem,
} from "../../types";

export function useMetadataEditing(
  item: LibraryItem,
  onUpdate: (item: LibraryItem) => void
) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(item.name);
  const [tempDescription, setTempDescription] = useState(
    item.description || ""
  );
  const [tempCategory, setTempCategory] = useState(item.category || "Main");
  const [tempViewMode, setTempViewMode] = useState<BuilderMode>(
    item.metadata?.viewMode || getSuggestedMode(item)
  );

  useEffect(() => {
    setTempName(item.name);
    setTempDescription(item.description || "");
    setTempCategory(item.category || "Main");
    setTempViewMode(item.metadata?.viewMode || getSuggestedMode(item));
    setIsEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only reset when item.id changes, not on every item property change
  }, [item.id]);

  const handleSave = useCallback(() => {
    if (!tempName.trim()) {
      return;
    }

    onUpdate({
      ...item,
      name: tempName.trim(),
      description: tempDescription.trim(),
      category: tempCategory,
      metadata: {
        ...item.metadata,
        viewMode: tempViewMode,
        updated: new Date().toISOString(),
      },
    });

    setIsEditing(false);
  }, [item, tempName, tempDescription, tempCategory, tempViewMode, onUpdate]);

  const handleCancel = useCallback(() => {
    setTempName(item.name);
    setTempDescription(item.description || "");
    setTempCategory(item.category || "Main");
    setTempViewMode(item.metadata?.viewMode || getSuggestedMode(item));
    setIsEditing(false);
  }, [item]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  const startEditing = useCallback(() => setIsEditing(true), []);

  return {
    isEditing,
    tempName,
    setTempName,
    tempDescription,
    setTempDescription,
    tempCategory,
    setTempCategory,
    tempViewMode,
    setTempViewMode,
    handleSave,
    handleCancel,
    handleKeyDown,
    startEditing,
  };
}
