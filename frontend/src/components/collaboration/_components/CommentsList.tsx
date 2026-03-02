"use client";

import { Avatar } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  type ReviewComment,
  decisionIcons,
  decisionColors,
  getInitials,
  formatReviewDate,
} from "../_types/review";

interface CommentsListProps {
  comments: ReviewComment[];
}

export function CommentsList({ comments }: CommentsListProps) {
  if (comments.length === 0) return null;

  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-2 block">
        Reviews ({comments.length})
      </Label>
      <ScrollArea className="max-h-[300px]">
        <div className="space-y-3">
          {comments.map((comment) => {
            const DecisionIcon = decisionIcons[comment.decision];
            return (
              <div
                key={comment.id}
                className="flex gap-3 p-3 border rounded-lg"
              >
                <Avatar
                  src={comment.reviewer_avatar}
                  fallback={
                    <span className="text-xs font-medium">
                      {getInitials(comment.reviewer_name)}
                    </span>
                  }
                  className="h-8 w-8 mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">
                      {comment.reviewer_name}
                    </span>
                    <DecisionIcon
                      className={cn(
                        "h-3 w-3",
                        decisionColors[comment.decision]
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs",
                        decisionColors[comment.decision]
                      )}
                    >
                      {comment.decision.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatReviewDate(comment.created_at)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">
                    {comment.comment}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
