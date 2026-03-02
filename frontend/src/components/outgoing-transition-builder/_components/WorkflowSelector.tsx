"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowSelectorProps {
  workflows: Workflow[];
  selectedWorkflows: string[];
  workflowCategoryFilter: string;
  onCategoryFilterChange: (category: string) => void;
  onAddWorkflow: (workflowId: string) => void;
  onRemoveWorkflow: (workflowId: string) => void;
}

function CategoryFilter({
  workflows,
  workflowCategoryFilter,
  onCategoryFilterChange,
}: Pick<
  WorkflowSelectorProps,
  "workflows" | "workflowCategoryFilter" | "onCategoryFilterChange"
>) {
  const extraCategories = useMemo(() => {
    return Array.from(
      new Set(workflows.map((w) => w.category || "Main"))
    ).filter(
      (c) =>
        c !== "Main" &&
        c !== "Transitions" &&
        c !== "Outgoing Transitions" &&
        c !== "Incoming Transitions"
    );
  }, [workflows]);

  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">Filter by Category</Label>
      <Select
        value={workflowCategoryFilter}
        onValueChange={onCategoryFilterChange}
      >
        <SelectTrigger className="bg-transparent border-border-subtle">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[100] bg-surface-raised border-border-default">
          <SelectItem value="All">All Categories</SelectItem>
          <SelectItem value="Outgoing Transitions">
            Outgoing Transitions
          </SelectItem>
          <SelectItem value="Incoming Transitions">
            Incoming Transitions
          </SelectItem>
          <SelectItem value="Main">Main</SelectItem>
          {extraCategories.map((category) => (
            <SelectItem key={category} value={category}>
              {category}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AvailableWorkflowList({
  workflows,
  selectedWorkflows,
  workflowCategoryFilter,
  onAddWorkflow,
}: Pick<
  WorkflowSelectorProps,
  "workflows" | "selectedWorkflows" | "workflowCategoryFilter" | "onAddWorkflow"
>) {
  const filteredWorkflows = useMemo(() => {
    return workflows
      .filter((w) => {
        const category = w.category || "Main";
        return (
          workflowCategoryFilter === "All" ||
          category === workflowCategoryFilter
        );
      })
      .filter((w) => !selectedWorkflows.includes(w.id));
  }, [workflows, workflowCategoryFilter, selectedWorkflows]);

  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">Available Workflows</Label>
      <div className="max-h-[180px] overflow-y-auto space-y-1 border border-border-default rounded p-2">
        {filteredWorkflows.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-4">
            {workflowCategoryFilter === "Outgoing Transitions"
              ? "No workflows in Outgoing Transitions category. Drag a StateImage to another state to create one, or try 'All Categories'."
              : "No available workflows"}
          </p>
        ) : (
          filteredWorkflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => onAddWorkflow(workflow.id)}
              className="w-full text-left p-2 bg-surface-overlay hover:bg-surface-sunken rounded text-sm transition-colors"
            >
              <div className="flex items-center gap-2">
                <span>{workflow.name}</span>
                <Badge className="text-xs">{workflow.category || "Main"}</Badge>
              </div>
              {workflow.description && (
                <p className="text-xs text-text-muted mt-1">
                  {workflow.description}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SelectedWorkflowList({
  workflows,
  selectedWorkflows,
  onRemoveWorkflow,
}: Pick<
  WorkflowSelectorProps,
  "workflows" | "selectedWorkflows" | "onRemoveWorkflow"
>) {
  if (selectedWorkflows.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">
        Selected Workflows (will execute in order)
      </Label>
      <div className="space-y-1">
        {selectedWorkflows.map((workflowId, index) => {
          const workflow = workflows.find((w) => w.id === workflowId);
          return (
            <div
              key={workflowId}
              className="flex items-center justify-between p-2 bg-surface-overlay rounded"
            >
              <div className="flex items-center gap-2 flex-1">
                <Badge className="text-xs bg-brand-success text-black">
                  {index + 1}
                </Badge>
                <span className="text-sm">{workflow?.name || "Unknown"}</span>
                {workflow?.category && (
                  <Badge variant="outline" className="text-xs">
                    {workflow.category}
                  </Badge>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                onClick={() => onRemoveWorkflow(workflowId)}
              >
                <span className="text-lg">&times;</span>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WorkflowSelector({
  workflows,
  selectedWorkflows,
  workflowCategoryFilter,
  onCategoryFilterChange,
  onAddWorkflow,
  onRemoveWorkflow,
}: WorkflowSelectorProps) {
  return (
    <div className="space-y-4 pt-4 border-t border-border-default">
      <Label>Workflows to Execute (Optional)</Label>
      <CategoryFilter
        workflows={workflows}
        workflowCategoryFilter={workflowCategoryFilter}
        onCategoryFilterChange={onCategoryFilterChange}
      />
      <AvailableWorkflowList
        workflows={workflows}
        selectedWorkflows={selectedWorkflows}
        workflowCategoryFilter={workflowCategoryFilter}
        onAddWorkflow={onAddWorkflow}
      />
      <SelectedWorkflowList
        workflows={workflows}
        selectedWorkflows={selectedWorkflows}
        onRemoveWorkflow={onRemoveWorkflow}
      />
    </div>
  );
}
