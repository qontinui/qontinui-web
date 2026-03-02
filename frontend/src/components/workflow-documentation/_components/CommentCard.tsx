import React from "react";
import { Action } from "@/lib/action-schema/action-types";
import { ActionComment } from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Edit2, Trash2, MoreVertical, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommentCardProps {
  comment: ActionComment;
  action: Action;
  isSelected?: boolean;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onStartEdit: (comment: ActionComment) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (commentId: string) => void;
}

export function CommentCard({
  comment,
  action,
  isSelected = false,
  isEditing,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: CommentCardProps) {
  return (
    <div
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
            <h4 className="font-medium text-sm">{action.name || action.id}</h4>
            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {action.type}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">ID: {action.id}</p>
        </div>

        {!isEditing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onStartEdit(comment)}>
                <Edit2 className="size-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(comment.id)}
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
            onChange={(e) => onEditingTextChange(e.target.value)}
            placeholder="Edit comment..."
            className="min-h-24"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onSaveEdit}>
              <Check className="size-4" />
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelEdit}>
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
}
