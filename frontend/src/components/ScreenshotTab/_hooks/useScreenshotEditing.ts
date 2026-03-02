import { useState } from "react";
import { Screenshot } from "../../../types/Screenshot";

export function useScreenshotEditing() {
  const [editingScreenshotId, setEditingScreenshotId] = useState<string | null>(
    null
  );
  const [editingName, setEditingName] = useState<string>("");

  const handleStartEdit = (screenshot: Screenshot) => {
    setEditingScreenshotId(screenshot.id);
    setEditingName(screenshot.name);
  };

  const handleCancelEdit = () => {
    setEditingScreenshotId(null);
    setEditingName("");
  };

  return {
    editingScreenshotId,
    editingName,
    setEditingName,
    handleStartEdit,
    handleCancelEdit,
  };
}
