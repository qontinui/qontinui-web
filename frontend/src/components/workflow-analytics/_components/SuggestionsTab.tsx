"use client";

import React from "react";
import { CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { OptimizationSuggestion } from "../performance-analyzer-types";
import { SuggestionCard } from "./SuggestionCard";

interface SuggestionsTabProps {
  suggestions: OptimizationSuggestion[];
  onApply: (suggestion: OptimizationSuggestion) => void;
  onDismiss: (suggestionId: string) => void;
}

export function SuggestionsTab({
  suggestions,
  onApply,
  onDismiss,
}: SuggestionsTabProps) {
  if (suggestions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Suggestions</h3>
          <p className="text-muted-foreground text-center">
            This workflow is already well-optimized, or run an analysis to find
            improvements.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {suggestions
        .sort((a, b) => b.estimatedImprovement - a.estimatedImprovement)
        .map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            onApply={() => onApply(suggestion)}
            onDismiss={() => onDismiss(suggestion.id)}
          />
        ))}
    </div>
  );
}
