/**
 * Graph Node Rendering Component
 *
 * Custom node component for rendering workflow nodes in the dependency graph.
 * Displays workflow name, dependency/dependent counts, tags, and status icons
 * with color-coding based on node state (leaf, circular, unused, normal).
 */

"use client";

import React from "react";
import { AlertCircle, EyeOff, Target, Network } from "lucide-react";
import { Badge } from "../../ui/badge";
import { cn } from "../../../lib/utils";
import { NodeRendererProps } from "./types";

function getNodeColor(data: NodeRendererProps["data"]): string {
  if (data.isCircular) return "border-red-500 bg-red-50 dark:bg-red-950";
  if (data.isUnused)
    return "border-border-default bg-surface-canvas dark:bg-surface-canvas";
  if (data.isLeaf) return "border-green-500 bg-green-50 dark:bg-green-950";
  return "border-blue-500 bg-blue-50 dark:bg-blue-950";
}

function getStatusIcon(data: NodeRendererProps["data"]): React.ReactNode {
  if (data.isCircular)
    return <AlertCircle className="h-3 w-3 text-red-600" />;
  if (data.isUnused) return <EyeOff className="h-3 w-3 text-text-muted" />;
  if (data.isLeaf) return <Target className="h-3 w-3 text-green-600" />;
  return <Network className="h-3 w-3 text-blue-600" />;
}

export function WorkflowNodeComponent({ data }: NodeRendererProps) {
  return (
    <div
      className={cn(
        "px-4 py-2 rounded-lg border-2 min-w-[180px] max-w-[250px] shadow-sm transition-all",
        getNodeColor(data)
      )}
    >
      <div className="flex items-start gap-2 mb-1">
        {getStatusIcon(data)}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {data.workflowName}
          </div>
          <div className="text-xs text-muted-foreground flex gap-2 mt-1">
            <span title="Dependencies">&darr; {data.dependencyCount}</span>
            <span title="Dependents">&uarr; {data.dependentCount}</span>
          </div>
        </div>
      </div>
      {data.tags && data.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-2">
          {data.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1 py-0">
              {tag}
            </Badge>
          ))}
          {data.tags.length > 2 && (
            <Badge variant="secondary" className="text-xs px-1 py-0">
              +{data.tags.length - 2}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
