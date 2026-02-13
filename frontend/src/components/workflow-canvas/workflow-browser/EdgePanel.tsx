/**
 * Workflow metadata badge components.
 *
 * Renders visual badges for workflow attributes such as test coverage,
 * documentation status, error state, recency, dependencies, and complexity.
 */

import React from "react";
import {
  TestTube,
  BookOpen,
  AlertTriangle,
  Clock,
  Link2,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import type { EnhancedWorkflowItem } from "./types";

// ============================================================================
// Workflow Badges Component
// ============================================================================

interface WorkflowBadgesProps {
  item: EnhancedWorkflowItem;
  compact?: boolean;
}

export function WorkflowBadges({ item, compact }: WorkflowBadgesProps) {
  const badges = [];

  if (item.hasTests) {
    badges.push(
      <TooltipProvider key="tests">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <TestTube className="h-3 w-3" />
              {!compact && "Tests"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Has test cases</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.hasDocumentation) {
    badges.push(
      <TooltipProvider key="docs">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <BookOpen className="h-3 w-3" />
              {!compact && "Docs"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Has documentation</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.failedLastRun) {
    badges.push(
      <TooltipProvider key="error">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {!compact && "Error"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Failed last run</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.recentlyModified) {
    badges.push(
      <TooltipProvider key="recent">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {!compact && "New"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Recently modified</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (item.hasDependencies) {
    badges.push(
      <TooltipProvider key="deps">
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <Link2 className="h-3 w-3" />
              {!compact && "Deps"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Has dependencies</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <>{badges}</>;
}

// ============================================================================
// Complexity Badge Component
// ============================================================================

interface ComplexityBadgeProps {
  rating?: "low" | "medium" | "high" | "very-high";
  score?: number;
}

export function ComplexityBadge({ rating, score }: ComplexityBadgeProps) {
  if (!rating) return null;

  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    low: "outline",
    medium: "secondary",
    high: "default",
    "very-high": "destructive",
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge variant={variants[rating]} className="text-xs">
            {rating.replace("-", " ")}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          Complexity score: {score?.toFixed(0)}/100
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
