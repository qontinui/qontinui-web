"use client";

import { Button } from "@/components/ui/button";
import { Plus, GitBranch } from "lucide-react";
import { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowListPanelProps {
  workflowList: Workflow[];
  selectedWorkflowId: string | undefined;
  onCreateWorkflow: () => void;
  onSelectWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string) => void;
}

export function WorkflowListPanel({
  workflowList,
  selectedWorkflowId,
  onCreateWorkflow,
  onSelectWorkflow,
  onDeleteWorkflow,
}: WorkflowListPanelProps) {
  return (
    <div
      className="w-64 border-r border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto flex-shrink-0"
      data-tutorial-id="workflow-list"
    >
      <div className="space-y-4">
        <Button
          onClick={onCreateWorkflow}
          className="w-full bg-brand-success hover:bg-brand-success/80 text-black font-medium"
          data-tutorial-id="create-workflow"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Workflow
        </Button>

        <div className="space-y-2">
          <div className="text-xs font-medium text-text-muted px-2 mb-2">
            WORKFLOWS ({workflowList.length})
          </div>

          {workflowList.length === 0 ? (
            <div className="text-sm text-text-muted text-center py-8">
              <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No workflows yet</p>
              <p className="text-xs">Create one to get started</p>
            </div>
          ) : (
            workflowList.map((workflow) => (
              <div
                key={workflow.id}
                className={`p-3 rounded-md cursor-pointer transition-colors ${
                  selectedWorkflowId === workflow.id
                    ? "bg-brand-success/20 border border-brand-success"
                    : "bg-surface-raised/50 hover:bg-surface-raised border border-transparent"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectWorkflow(workflow)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectWorkflow(workflow);
                  }
                }}
              >
                <div className="font-medium text-sm text-text-secondary">
                  {workflow.name}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {workflow.actions.length} actions
                </div>

                {selectedWorkflowId === workflow.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWorkflow(workflow.id);
                    }}
                    className="w-full mt-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    Delete
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
