"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Search, Workflow, Loader2 } from "lucide-react";

interface WorkflowSelectorProps {
  workflowName: string;
  setWorkflowName: (v: string) => void;
  workflowSearch: string;
  setWorkflowSearch: (v: string) => void;
  filteredWorkflows: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  workflowsLoading: boolean;
}

export function WorkflowSelector({
  workflowName,
  setWorkflowName,
  workflowSearch,
  setWorkflowSearch,
  filteredWorkflows,
  workflowsLoading,
}: WorkflowSelectorProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-text-muted">Workflow</p>
      {workflowName && (
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className="bg-brand-primary/10 text-brand-primary border-brand-primary/30"
          >
            <Workflow className="size-3 mr-1" />
            {workflowName}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-text-muted hover:text-red-400"
            onClick={() => setWorkflowName("")}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
        <Input
          placeholder="Search workflows..."
          value={workflowSearch}
          onChange={(e) => setWorkflowSearch(e.target.value)}
          className="pl-8 h-8 bg-surface-canvas/50 border-border-subtle/50 text-xs"
        />
      </div>
      <div className="max-h-[140px] overflow-y-auto space-y-1 mt-1">
        {workflowsLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-4 animate-spin text-text-muted" />
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-3">
            No workflows found
          </p>
        ) : (
          filteredWorkflows.map((w) => (
            <div
              key={w.id}
              className={`px-3 py-2 rounded-md text-xs cursor-pointer transition-colors ${
                workflowName === w.name
                  ? "bg-brand-primary/10 border border-brand-primary/30 text-brand-primary"
                  : "bg-surface-canvas/30 border border-transparent hover:border-border-subtle text-text-secondary hover:text-text-primary"
              }`}
              role="button"
              tabIndex={0}
              onClick={() => setWorkflowName(w.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setWorkflowName(w.name);
                }
              }}
            >
              <span className="font-medium">{w.name}</span>
              {w.description && (
                <p className="text-text-muted mt-0.5 line-clamp-1">
                  {w.description}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
