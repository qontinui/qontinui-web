"use client";

import React, { useState, useMemo } from "react";
import { Workflow, Action } from "@/lib/action-schema/action-types";
import { ActionComment } from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MessageSquare,
  Plus,
  Edit2,
  Trash2,
  MoreVertical,
  Search,
  Download,
  X,
  Check,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Props
// ============================================================================

export interface ActionCommentsPanelProps {
  workflow: Workflow;
  comments: ActionComment[];
  selectedActionId?: string;
  onAddComment: (actionId: string, comment: string) => void;
  onUpdateComment: (commentId: string, comment: string) => void;
  onDeleteComment: (commentId: string) => void;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function ActionCommentsPanel({
  workflow,
  comments,
  selectedActionId,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  className,
}: ActionCommentsPanelProps) {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [newCommentText, setNewCommentText] = useState("");
  const [showNewCommentForm, setShowNewCommentForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"selected" | "all">("selected");

  // Get action by ID
  const getAction = (actionId: string): Action | undefined => {
    return workflow.actions.find((a) => a.id === actionId);
  };

  // Get comment for selected action
  const selectedActionComment = useMemo(() => {
    if (!selectedActionId) return null;
    return comments.find((c) => c.actionId === selectedActionId);
  }, [comments, selectedActionId]);

  // Get all actions with comments
  const actionsWithComments = useMemo(() => {
    const commentMap = new Map<string, ActionComment>();
    comments.forEach((comment) => {
      commentMap.set(comment.actionId, comment);
    });

    return workflow.actions
      .filter((action) => commentMap.has(action.id))
      .map((action) => ({
        action,
        comment: commentMap.get(action.id)!,
      }));
  }, [workflow.actions, comments]);

  // Filter actions by search
  const filteredActions = useMemo(() => {
    if (!searchQuery) return actionsWithComments;

    const query = searchQuery.toLowerCase();
    return actionsWithComments.filter(
      ({ action, comment }) =>
        action.name?.toLowerCase().includes(query) ||
        action.id.toLowerCase().includes(query) ||
        action.type.toLowerCase().includes(query) ||
        comment.comment.toLowerCase().includes(query)
    );
  }, [actionsWithComments, searchQuery]);

  // Handle add comment
  const handleAddComment = () => {
    if (!selectedActionId || !newCommentText.trim()) return;

    onAddComment(selectedActionId, newCommentText);
    setNewCommentText("");
    setShowNewCommentForm(false);
  };

  // Handle start editing
  const handleStartEdit = (comment: ActionComment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.comment);
  };

  // Handle save edit
  const handleSaveEdit = () => {
    if (!editingCommentId || !editingText.trim()) return;

    onUpdateComment(editingCommentId, editingText);
    setEditingCommentId(null);
    setEditingText("");
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingText("");
  };

  // Handle delete
  const handleDelete = (commentId: string) => {
    setDeleteConfirmId(commentId);
  };

  const confirmDelete = () => {
    if (deleteConfirmId) {
      onDeleteComment(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  // Export comments
  const handleExportComments = () => {
    const exportData = actionsWithComments.map(({ action, comment }) => ({
      actionId: action.id,
      actionName: action.name || action.id,
      actionType: action.type,
      comment: comment.comment,
      created: comment.created,
      updated: comment.updated,
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.name}-comments.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Render comment card
  const renderCommentCard = (
    comment: ActionComment,
    action: Action,
    isSelected: boolean = false
  ) => {
    const isEditing = editingCommentId === comment.id;

    return (
      <div
        key={comment.id}
        className={cn(
          "p-4 rounded-lg border transition-colors",
          isSelected && "border-primary bg-accent",
          !isSelected && "border-border hover:border-primary/50"
        )}
      >
        {/* Action Info */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm">
                {action.name || action.id}
              </h4>
              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                {action.type}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ID: {action.id}
            </p>
          </div>

          {!isEditing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleStartEdit(comment)}>
                  <Edit2 className="size-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDelete(comment.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Comment Content */}
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              placeholder="Edit comment..."
              className="min-h-24"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSaveEdit}>
                <Check className="size-4" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                <X className="size-4" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {comment.comment}
            </p>

            {/* Metadata */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
              <div>{comment.author && <span>by {comment.author}</span>}</div>
              <div className="flex items-center gap-2">
                <span>{new Date(comment.updated).toLocaleDateString()}</span>
                {comment.updated !== comment.created && (
                  <span className="text-xs">(edited)</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5" />
            <h2 className="text-lg font-semibold">Action Comments</h2>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportComments}
              disabled={comments.length === 0}
            >
              <Download className="size-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search comments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "selected" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("selected")}
            disabled={!selectedActionId}
          >
            Selected Action
          </Button>
          <Button
            variant={viewMode === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("all")}
          >
            All Comments ({comments.length})
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Selected Action View */}
          {viewMode === "selected" && selectedActionId && (
            <div className="space-y-4">
              {/* Selected Action Info */}
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">
                    {getAction(selectedActionId)?.name || selectedActionId}
                  </h3>
                  <span className="text-xs px-2 py-1 rounded bg-background">
                    {getAction(selectedActionId)?.type}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  ID: {selectedActionId}
                </p>
              </div>

              {/* Existing Comment */}
              {selectedActionComment && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Comment</h4>
                  {renderCommentCard(
                    selectedActionComment,
                    getAction(selectedActionId)!,
                    true
                  )}
                </div>
              )}

              {/* Add New Comment */}
              {!selectedActionComment && (
                <div className="space-y-2">
                  {showNewCommentForm ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Add Comment</Label>
                      <Textarea
                        value={newCommentText}
                        onChange={(e) => setNewCommentText(e.target.value)}
                        placeholder="Add a comment to describe what this action does..."
                        className="min-h-32"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={handleAddComment}>
                          <Check className="size-4" />
                          Add Comment
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setShowNewCommentForm(false);
                            setNewCommentText("");
                          }}
                        >
                          <X className="size-4" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowNewCommentForm(true)}
                    >
                      <Plus className="size-4" />
                      Add Comment
                    </Button>
                  )}
                </div>
              )}

              {/* Help Text */}
              {!selectedActionComment && !showNewCommentForm && (
                <div className="p-4 rounded-lg bg-muted/30 border border-dashed">
                  <p className="text-sm text-muted-foreground">
                    Add comments to document what this action does, why it&apos;s
                    needed, or any important notes for other developers.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* All Comments View */}
          {viewMode === "all" && (
            <div className="space-y-4">
              {filteredActions.length > 0 ? (
                <>
                  <div className="text-sm text-muted-foreground">
                    {filteredActions.length} action
                    {filteredActions.length !== 1 && "s"} with comments
                  </div>

                  {filteredActions.map(({ action, comment }) => (
                    <div key={comment.id}>
                      {renderCommentCard(comment, action)}
                    </div>
                  ))}
                </>
              ) : searchQuery ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="size-12 mx-auto mb-4 opacity-50" />
                  <p>No comments found for &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="size-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No action comments yet</p>
                  <p className="text-sm">
                    Select an action and add a comment to get started
                  </p>
                </div>
              )}
            </div>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={() => setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this comment? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Label component (if not already in your project)
function Label({
  children,
  className,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    >
      {children}
    </label>
  );
}
