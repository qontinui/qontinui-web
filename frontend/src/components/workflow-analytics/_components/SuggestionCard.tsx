"use client";

import React from "react";
import { TrendingUp, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OptimizationSuggestion } from "../performance-analyzer-types";
import {
  SUGGESTION_ICONS,
  getSeverityColor,
  formatDuration,
  formatPercentage,
} from "../performance-analyzer-utils";

interface SuggestionCardProps {
  suggestion: OptimizationSuggestion;
  onApply: () => void;
  onDismiss: () => void;
}

export function SuggestionCard({
  suggestion,
  onApply,
  onDismiss,
}: SuggestionCardProps) {
  const Icon = SUGGESTION_ICONS[suggestion.type];

  return (
    <Card className={cn("border-l-4", suggestion.applied && "opacity-60")}>
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: getSeverityColor(suggestion.severity) }}
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">{suggestion.title}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  {suggestion.type.replace("-", " ")}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-xs"
                  style={{ borderColor: getSeverityColor(suggestion.severity) }}
                >
                  {suggestion.severity}
                </Badge>
              </div>
            </div>
          </div>
          {suggestion.applied && (
            <CheckCircle className="h-5 w-5 text-green-500" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {suggestion.description}
        </p>

        <div className="flex items-center justify-between text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="font-medium">Estimated improvement:</span>
            </div>
            <div className="text-lg font-bold text-green-500">
              {formatDuration(suggestion.estimatedImprovement)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              {formatPercentage(suggestion.impactPercentage)}
            </div>
            <div className="text-xs text-muted-foreground">of total time</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Affects {suggestion.affectedActions.length} action
          {suggestion.affectedActions.length !== 1 ? "s" : ""}
        </div>

        {!suggestion.applied && (
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={onApply} size="sm" className="flex-1">
              <CheckCircle className="h-4 w-4 mr-2" />
              Apply
            </Button>
            <Button onClick={onDismiss} variant="outline" size="sm">
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
