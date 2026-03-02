import React from "react";
import { ActionComment } from "@/services/workflow-documentation-service";
import { MessageSquare, Search } from "lucide-react";
import { ActionWithComment } from "../types";
import { CommentCard } from "./CommentCard";

interface AllCommentsViewProps {
  filteredActions: ActionWithComment[];
  searchQuery: string;
  editingCommentId: string | null;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onStartEdit: (comment: ActionComment) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (commentId: string) => void;
}

export function AllCommentsView({
  filteredActions,
  searchQuery,
  editingCommentId,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: AllCommentsViewProps) {
  if (filteredActions.length > 0) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {filteredActions.length} action
          {filteredActions.length !== 1 && "s"} with comments
        </div>

        {filteredActions.map(({ action, comment }) => (
          <div key={comment.id}>
            <CommentCard
              comment={comment}
              action={action}
              isEditing={editingCommentId === comment.id}
              editingText={editingText}
              onEditingTextChange={onEditingTextChange}
              onStartEdit={onStartEdit}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>
    );
  }

  if (searchQuery) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Search className="size-12 mx-auto mb-4 opacity-50" />
        <p>No comments found for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  return (
    <div className="text-center py-12 text-muted-foreground">
      <MessageSquare className="size-12 mx-auto mb-4 opacity-50" />
      <p className="mb-2">No action comments yet</p>
      <p className="text-sm">
        Select an action and add a comment to get started
      </p>
    </div>
  );
}
