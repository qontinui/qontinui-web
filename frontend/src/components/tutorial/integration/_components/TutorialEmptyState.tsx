import React from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TutorialEmptyStateProps {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function TutorialEmptyState({
  hasActiveFilters,
  onClearFilters,
}: TutorialEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-semibold mb-2">No tutorials found</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {hasActiveFilters
          ? "Try adjusting your filters or search query to find tutorials."
          : "No tutorials are available at the moment."}
      </p>
      {hasActiveFilters && (
        <Button variant="outline" onClick={onClearFilters} className="mt-4">
          Clear Filters
        </Button>
      )}
    </div>
  );
}
