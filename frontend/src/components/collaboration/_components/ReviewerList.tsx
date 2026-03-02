"use client";

import { Clock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type Reviewer,
  type ReviewComment,
  decisionIcons,
  decisionColors,
  getInitials,
} from "../_types/review";

interface ReviewerListProps {
  reviewers: Reviewer[];
  comments: ReviewComment[];
}

export function ReviewerList({ reviewers, comments }: ReviewerListProps) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-2 block">
        Reviewers ({reviewers.length})
      </Label>
      <div className="space-y-2">
        {reviewers.map((reviewer) => {
          const review = comments.find((c) => c.reviewer_id === reviewer.id);
          const DecisionIcon = review ? decisionIcons[review.decision] : Clock;

          return (
            <div
              key={reviewer.id}
              className="flex items-center gap-3 p-2 rounded-lg border"
            >
              <Avatar
                src={reviewer.avatar_url}
                fallback={
                  <span className="text-xs font-medium">
                    {getInitials(reviewer.name)}
                  </span>
                }
                className="h-8 w-8"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium">{reviewer.name}</span>
                {review && (
                  <span className="text-xs text-muted-foreground">
                    {review.decision.replace("_", " ")}
                  </span>
                )}
              </div>
              <DecisionIcon
                className={cn(
                  "h-4 w-4",
                  review
                    ? decisionColors[review.decision]
                    : "text-muted-foreground"
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
