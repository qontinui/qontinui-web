"use client";

import { Loader2, AlertCircle } from "lucide-react";
import {
  apiClient,
  type FindingCategoryConfig,
  type FindingCategoryConfigCreate,
} from "@/lib/api-client";
import {
  useCategoryData,
  useCategoryForm,
  useCategoryEdit,
  useCategoryOperations,
} from "./_hooks";
import {
  PageHeader,
  CreateCategoryForm,
  CategoryList,
  DeleteDialog,
  ResetDialog,
} from "./_components";
import { slugify } from "./finding-rules-utils";

// ─── Main component ─────────────────────────────────────────────────────────

export default function FindingRulesPage() {
  const {
    categories,
    setCategories,
    isLoading,
    setIsLoading,
    error,
    searchQuery,
    setSearchQuery,
    fetchCategories,
    filteredCategories,
  } = useCategoryData();

  const {
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
  } = useCategoryForm();

  const {
    editingId,
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
  } = useCategoryEdit();

  const {
    deletingId,
    setDeletingId,
    isDeleting,
    setIsDeleting,
    showResetDialog,
    setShowResetDialog,
    isResetting,
    setIsResetting,
    togglingId,
    setTogglingId,
  } = useCategoryOperations();

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!formName.trim()) {
      setSaveError("Name is required");
      return;
    }

    const slug = slugify(formName);
    if (!slug) {
      setSaveError("Name must contain at least one letter or number");
      return;
    }

    if (categories.some((c) => c.slug === slug)) {
      setSaveError(`A category with slug "${slug}" already exists`);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const data: FindingCategoryConfigCreate = {
        slug,
        name: formName.trim(),
        description: formDescription.trim(),
        icon: formIcon,
        color: formColor,
        default_action_type: formActionType,
        sort_order: categories.length + 1,
        enabled: formEnabled,
      };
      await apiClient.createFindingCategory(data);
      resetForm();
      await fetchCategories();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to create category"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async (cat: FindingCategoryConfig) => {
    try {
      await apiClient.updateFindingCategory(cat.id, {
        name: editName.trim() || undefined,
        description: editDescription,
        icon: editIcon,
        color: editColor,
        default_action_type: editActionType,
      });
      cancelEdit();
      await fetchCategories();
    } catch {
      // stay in edit mode
    }
  };

  const handleToggleEnabled = async (cat: FindingCategoryConfig) => {
    setTogglingId(cat.id);
    try {
      await apiClient.updateFindingCategory(cat.id, {
        enabled: !cat.enabled,
      });
      await fetchCategories();
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteFindingCategory(deletingId);
      setDeletingId(null);
      await fetchCategories();
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const data = await apiClient.resetFindingCategories();
      setCategories(data);
      setShowResetDialog(false);
    } catch {
      // ignore
    } finally {
      setIsResetting(false);
    }
  };

  const handleReorder = async (
    cat: FindingCategoryConfig,
    direction: "up" | "down"
  ) => {
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((c) => c.id === cat.id);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= sorted.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const other = sorted[swapIdx];
    if (!other) return;

    try {
      await Promise.all([
        apiClient.updateFindingCategory(cat.id, {
          sort_order: other.sort_order,
        }),
        apiClient.updateFindingCategory(other.id, {
          sort_order: cat.sort_order,
        }),
      ]);
      await fetchCategories();
    } catch {
      // ignore
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <PageHeader
        onResetClick={() => setShowResetDialog(true)}
        onRefreshClick={() => {
          setIsLoading(true);
          fetchCategories();
        }}
        onAddClick={() => setShowForm(true)}
        isAddDisabled={showForm}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6 w-full">
        {/* Error Banner */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Create Form */}
        {showForm && (
          <CreateCategoryForm
            formName={formName}
            formDescription={formDescription}
            formIcon={formIcon}
            formColor={formColor}
            formActionType={formActionType}
            formEnabled={formEnabled}
            isSaving={isSaving}
            saveError={saveError}
            onFormNameChange={setFormName}
            onFormDescriptionChange={setFormDescription}
            onFormIconChange={setFormIcon}
            onFormColorChange={setFormColor}
            onFormActionTypeChange={setFormActionType}
            onFormEnabledChange={setFormEnabled}
            onCancel={resetForm}
            onCreate={handleCreate}
          />
        )}

        {/* Categories List */}
        <CategoryList
          categories={categories}
          filteredCategories={filteredCategories}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          editingId={editingId}
          editName={editName}
          editDescription={editDescription}
          editIcon={editIcon}
          editColor={editColor}
          editActionType={editActionType}
          onEditNameChange={setEditName}
          onEditDescriptionChange={setEditDescription}
          onEditIconChange={setEditIcon}
          onEditColorChange={setEditColor}
          onEditActionTypeChange={setEditActionType}
          onCancelEdit={cancelEdit}
          onSaveEdit={handleSaveEdit}
          togglingId={togglingId}
          onReorder={handleReorder}
          onToggleEnabled={handleToggleEnabled}
          onStartEdit={startEdit}
          onDelete={setDeletingId}
        />
      </main>

      {/* Delete Confirmation Dialog */}
      <DeleteDialog
        open={deletingId !== null}
        isDeleting={isDeleting}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
        onConfirm={handleDelete}
      />

      {/* Reset Confirmation Dialog */}
      <ResetDialog
        open={showResetDialog}
        isResetting={isResetting}
        onOpenChange={setShowResetDialog}
        onConfirm={handleReset}
      />
    </div>
  );
}
