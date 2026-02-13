import { useState } from "react";
import type {
  FindingCategoryConfig,
  FindingCategoryActionType,
} from "@/lib/api-client";

export function useCategoryEdit() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editActionType, setEditActionType] =
    useState<FindingCategoryActionType>("auto_fix");

  const startEdit = (cat: FindingCategoryConfig) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDescription(cat.description);
    setEditIcon(cat.icon);
    setEditColor(cat.color);
    setEditActionType(cat.default_action_type);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return {
    editingId,
    setEditingId,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
    editIcon,
    setEditIcon,
    editColor,
    setEditColor,
    editActionType,
    setEditActionType,
    startEdit,
    cancelEdit,
  };
}
