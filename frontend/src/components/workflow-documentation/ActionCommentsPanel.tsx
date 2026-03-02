"use client";

import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionCommentsPanelProps } from "./types";
import { useActionComments } from "./_hooks/useActionComments";
import { CommentsPanelHeader } from "./_components/CommentsPanelHeader";
import { SelectedActionView } from "./_components/SelectedActionView";
import { AllCommentsView } from "./_components/AllCommentsView";
import { DeleteConfirmDialog } from "@/components/common/_components/DeleteConfirmDialog";

export type { ActionCommentsPanelProps } from "./types";

export function ActionCommentsPanel({
  workflow,
  comments,
  selectedActionId,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  className,
}: ActionCommentsPanelProps) {
  const {
    editingCommentId,
    editingText,
    newCommentText,
    showNewCommentForm,
    searchQuery,
    deleteConfirmId,
    viewMode,
    selectedActionComment,
    filteredActions,
    setEditingText,
    setNewCommentText,
    setSearchQuery,
    setViewMode,
    setShowNewCommentForm,
    getAction,
    handleAddComment,
    handleStartEdit,
    handleSaveEdit,
    handleCancelEdit,
    handleDelete,
    confirmDelete,
    dismissDelete,
    handleExportComments,
    cancelNewComment,
  } = useActionComments({
    workflow,
    comments,
    selectedActionId,
    onAddComment,
    onUpdateComment,
    onDeleteComment,
  });

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      <CommentsPanelHeader
        commentsCount={comments.length}
        searchQuery={searchQuery}
        viewMode={viewMode}
        selectedActionId={selectedActionId}
        onSearchChange={setSearchQuery}
        onViewModeChange={setViewMode}
        onExport={handleExportComments}
      />

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Selected Action View */}
          {viewMode === "selected" && selectedActionId && (
            <SelectedActionView
              selectedActionId={selectedActionId}
              selectedAction={getAction(selectedActionId)}
              selectedActionComment={selectedActionComment}
              showNewCommentForm={showNewCommentForm}
              newCommentText={newCommentText}
              editingCommentId={editingCommentId}
              editingText={editingText}
              onEditingTextChange={setEditingText}
              onNewCommentTextChange={setNewCommentText}
              onShowNewCommentForm={setShowNewCommentForm}
              onAddComment={handleAddComment}
              onCancelNewComment={cancelNewComment}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onDelete={handleDelete}
            />
          )}

          {/* All Comments View */}
          {viewMode === "all" && (
            <AllCommentsView
              filteredActions={filteredActions}
              searchQuery={searchQuery}
              editingCommentId={editingCommentId}
              editingText={editingText}
              onEditingTextChange={setEditingText}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onDelete={handleDelete}
            />
          )}

          {/* No Selection State */}
          {viewMode === "selected" && !selectedActionId && (
            <div className="text-center py-12 text-muted-foreground">
              <ChevronRight className="size-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No action selected</p>
              <p className="text-sm">
                Select an action from the workflow canvas to view or add
                comments
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <DeleteConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={() => dismissDelete()}
        onConfirm={confirmDelete}
        title="Delete Comment"
        description="Are you sure you want to delete this comment? This action cannot be undone."
      />
    </div>
  );
}
