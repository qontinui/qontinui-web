import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type { Context } from "@qontinui/schemas/config";
import {
  CONTEXT_CATEGORIES,
  countAutoIncludeRules,
  contextToFormData,
  formDataToContext,
  emptyFormData,
} from "../context-utils";
import type { ContextFormData } from "../context-utils";

export function useContextsManager() {
  const contexts = useAutomationStore((s) => s.contexts);
  const addContext = useAutomationStore((s) => s.addContext);
  const updateContext = useAutomationStore((s) => s.updateContext);
  const deleteContext = useAutomationStore((s) => s.deleteContext);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingContext, setEditingContext] = useState<Context | null>(null);
  const [contextToDelete, setContextToDelete] = useState<Context | null>(null);
  const [formData, setFormData] = useState<ContextFormData>(emptyFormData);
  const [showAutoIncludeSection, setShowAutoIncludeSection] = useState(false);

  // Get unique categories from contexts
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    contexts.forEach((ctx) => {
      if (ctx.category) cats.add(ctx.category);
    });
    // Add predefined categories
    CONTEXT_CATEGORIES.forEach((cat) => cats.add(cat));
    return Array.from(cats).sort();
  }, [contexts]);

  // Count contexts by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: contexts.length };
    contexts.forEach((ctx) => {
      const cat = ctx.category || "uncategorized";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [contexts]);

  // Filter contexts by search query and category
  const filteredContexts = useMemo(() => {
    return contexts.filter((context) => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        context.name.toLowerCase().includes(searchLower) ||
        context.content.toLowerCase().includes(searchLower) ||
        context.tags?.some((tag) => tag.toLowerCase().includes(searchLower)) ||
        context.category?.toLowerCase().includes(searchLower);

      const matchesCategory =
        categoryFilter === "all" ||
        (categoryFilter === "uncategorized" && !context.category) ||
        context.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [contexts, searchQuery, categoryFilter]);

  // Open create dialog
  const handleOpenCreate = useCallback(() => {
    setFormData(emptyFormData);
    setShowAutoIncludeSection(false);
    setShowCreateDialog(true);
  }, []);

  // Open edit dialog
  const handleOpenEdit = useCallback((context: Context) => {
    setFormData(contextToFormData(context));
    setShowAutoIncludeSection(countAutoIncludeRules(context.autoInclude) > 0);
    setEditingContext(context);
  }, []);

  // Save context (create or update)
  const handleSave = useCallback(() => {
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!formData.content.trim()) {
      toast.error("Content is required");
      return;
    }

    const context = formDataToContext(formData, editingContext || undefined);

    if (editingContext) {
      updateContext(context);
      toast.success("Context updated", {
        description: `"${context.name}" has been updated.`,
      });
      setEditingContext(null);
    } else {
      addContext(context);
      toast.success("Context created", {
        description: `"${context.name}" has been added to your library.`,
      });
      setShowCreateDialog(false);
    }

    setFormData(emptyFormData);
  }, [formData, editingContext, updateContext, addContext]);

  // Delete context
  const handleConfirmDelete = useCallback(() => {
    if (!contextToDelete) return;
    deleteContext(contextToDelete.id);
    toast.success("Context deleted", {
      description: `"${contextToDelete.name}" has been removed.`,
    });
    setContextToDelete(null);
  }, [contextToDelete, deleteContext]);

  // Close dialogs
  const handleCloseCreate = useCallback(() => {
    setShowCreateDialog(false);
    setFormData(emptyFormData);
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditingContext(null);
    setFormData(emptyFormData);
  }, []);

  return {
    // State
    contexts,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    showCreateDialog,
    setShowCreateDialog,
    editingContext,
    contextToDelete,
    setContextToDelete,
    formData,
    setFormData,
    showAutoIncludeSection,
    setShowAutoIncludeSection,

    // Computed
    availableCategories,
    categoryCounts,
    filteredContexts,

    // Handlers
    handleOpenCreate,
    handleOpenEdit,
    handleSave,
    handleConfirmDelete,
    handleCloseCreate,
    handleCloseEdit,
  };
}
