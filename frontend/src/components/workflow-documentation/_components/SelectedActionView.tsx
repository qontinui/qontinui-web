import React from "react";
import { Action } from "@/lib/action-schema/action-types";
import { ActionComment } from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommentCard } from "./CommentCard";

interface SelectedActionViewProps {
  selectedActionId: string;
  selectedAction: Action | undefined;
  selectedActionComment: ActionComment | null;
  showNewCommentForm: boolean;
  newCommentText: string;
  editingCommentId: string | null;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onNewCommentTextChange: (text: string) => void;
  onShowNewCommentForm: (show: boolean) => void;
  onAddComment: () => void;
  onCancelNewComment: () => void;
  onStartEdit: (comment: ActionComment) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (commentId: string) => void;
}

export function SelectedActionView({
  selectedActionId,
  selectedAction,
  selectedActionComment,
  showNewCommentForm,
  newCommentText,
  editingCommentId,
  editingText,
  onEditingTextChange,
  onNewCommentTextChange,
  onShowNewCommentForm,
  onAddComment,
  onCancelNewComment,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: SelectedActionViewProps) {
  return (
    <div className="space-y-4">
      {/* Selected Action Info */}
      <div className="p-4 rounded-lg bg-muted/50 border border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">
            {selectedAction?.name || selectedActionId}
          </h3>
          <span className="text-xs px-2 py-1 rounded bg-background">
            {selectedAction?.type}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">ID: {selectedActionId}</p>
      </div>

      {/* Existing Comment */}
      {selectedActionComment && selectedAction && (
        <div>
          <h4 className="text-sm font-medium mb-2">Comment</h4>
          <CommentCard
            comment={selectedActionComment}
            action={selectedAction}
            isSelected
            isEditing={editingCommentId === selectedActionComment.id}
            editingText={editingText}
            onEditingTextChange={onEditingTextChange}
            onStartEdit={onStartEdit}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            onDelete={onDelete}
          />
        </div>
      )}

      {/* Add New Comment */}
      {!selectedActionComment && (
        <div className="space-y-2">
          {showNewCommentForm ? (
            <div className="space-y-2">
              <label htmlFor="classname--cn-0"
                className={cn(
                  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                )}
              >
                Add Comment
              </label>
              <Textarea id="classname--cn-0"
                value={newCommentText}
                onChange={(e) => onNewCommentTextChange(e.target.value)}
                placeholder="Add a comment to describe what this action does..."
                className="min-h-32"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={onAddComment}>
                  <Check className="size-4" />
                  Add Comment
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancelNewComment}
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
              onClick={() => onShowNewCommentForm(true)}
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
  );
}
