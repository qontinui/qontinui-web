"use client";

import { Button } from "@/components/ui/button";
import { BookOpen, Plus, Filter } from "lucide-react";

export interface ContextsEmptyStateProps {
  hasContexts: boolean;
  hasFilteredResults: boolean;
  onCreateClick: () => void;
}

export function ContextsEmptyState({
  hasContexts,
  hasFilteredResults,
  onCreateClick,
}: ContextsEmptyStateProps) {
  if (!hasContexts) {
    return (
      <div className="text-center py-12 text-text-muted">
        <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No contexts created</p>
        <p className="text-sm mb-4 max-w-md mx-auto">
          Contexts inject domain knowledge into AI prompts during automation.
          Expand the help section above to learn about use cases for inline AI
          actions in GUI automation.
        </p>
        <Button
          onClick={onCreateClick}
          className="bg-brand-success hover:bg-brand-success/80 text-black"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create First Context
        </Button>
      </div>
    );
  }

  if (!hasFilteredResults) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Filter className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No contexts found</p>
        <p className="text-sm">Try adjusting your search or filter</p>
      </div>
    );
  }

  return null;
}
