import { useState, useCallback } from "react";
import type { FindingCategoryActionType } from "@/lib/api-client";

export function useCategoryForm() {
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIcon, setFormIcon] = useState("Bug");
  const [formColor, setFormColor] = useState("red");
  const [formActionType, setFormActionType] =
    useState<FindingCategoryActionType>("auto_fix");
  const [formEnabled, setFormEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormDescription("");
    setFormIcon("Bug");
    setFormColor("red");
    setFormActionType("auto_fix");
    setFormEnabled(true);
    setSaveError(null);
    setShowForm(false);
  }, []);

  return {
    showForm,
    setShowForm,
    formName,
    setFormName,
    formDescription,
    setFormDescription,
    formIcon,
    setFormIcon,
    formColor,
    setFormColor,
    formActionType,
    setFormActionType,
    formEnabled,
    setFormEnabled,
    isSaving,
    setIsSaving,
    saveError,
    setSaveError,
    resetForm,
  };
}
