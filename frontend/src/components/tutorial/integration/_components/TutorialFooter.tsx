import React from "react";
import { CheckCircle2, PlayCircle } from "lucide-react";

interface TutorialFooterProps {
  filteredCount: number;
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
}

export function TutorialFooter({
  filteredCount,
  totalCount,
  completedCount,
  inProgressCount,
}: TutorialFooterProps) {
  return (
    <div className="flex-shrink-0 p-4 bg-muted/50">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing {filteredCount} of {totalCount} tutorials
        </span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {completedCount} completed
          </span>
          <span className="flex items-center gap-1">
            <PlayCircle className="h-3 w-3" />
            {inProgressCount} in progress
          </span>
        </div>
      </div>
    </div>
  );
}
