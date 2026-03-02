"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowListProps {
  workflowIds: string[];
  processes: Workflow[];
  onRemove: (workflowId: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

export function WorkflowList({
  workflowIds,
  processes,
  onRemove,
  onMoveUp,
  onMoveDown,
}: WorkflowListProps) {
  if (!workflowIds || workflowIds.length === 0) {
    return (
      <div className="p-2 bg-surface-overlay rounded text-sm text-text-muted text-center">
        No workflows selected
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {workflowIds.map((workflowId, index) => {
        const workflow = processes.find((p) => p.id === workflowId);
        return (
          <div
            key={workflowId}
            className="flex items-center justify-between p-2 bg-surface-overlay rounded"
          >
            <div className="flex flex-col gap-1 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs bg-brand-primary/20 text-brand-primary border-brand-primary/50"
                >
                  {index + 1}
                </Badge>
                <span className="text-sm">
                  {workflow?.name || "Unknown Workflow"}
                </span>
                {workflow?.category && (
                  <Badge variant="outline" className="text-xs">
                    {workflow.category}
                  </Badge>
                )}
              </div>
              {workflow?.description && (
                <span className="text-xs text-text-muted ml-6">
                  {workflow.description}
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-text-muted hover:text-text-primary"
                disabled={index === 0}
                onClick={() => onMoveUp(index)}
              >
                <ChevronUp className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-text-muted hover:text-text-primary"
                disabled={index === workflowIds.length - 1}
                onClick={() => onMoveDown(index)}
              >
                <ChevronDown className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                onClick={() => onRemove(workflowId)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
