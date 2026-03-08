"use client";

import { useState, useMemo } from "react";
import * as workflowApi from "@/lib/api/unified-workflows";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { WorkflowListItem } from "./WorkflowListItem";
import {
  Plus,
  Search,
  Workflow,
  Trash2,
  Copy,
  Play,
  X,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";

export function WorkflowListSidebar({
  selectedWorkflowId,
  onSelectWorkflow,
  onDeselectWorkflow,
  onRunWorkflow,
}: {
  selectedWorkflowId: string | null;
  onSelectWorkflow: (workflow: UnifiedWorkflow) => void;
  onDeselectWorkflow: () => void;
  onRunWorkflow: (workflowId: string) => void;
}) {
  const {
    data: workflows,
    isLoading,
    error,
    refetch,
  } = useUnifiedWorkflows();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.description ?? "").toLowerCase().includes(q)
    );
  }, [workflows, searchQuery]);

  const handleCreateWorkflow = async () => {
    try {
      const newWorkflow = await workflowApi.createWorkflow({
        name: "New Workflow",
        description: "",
        setup_steps: [],
        verification_steps: [],
        agentic_steps: [],
        completion_steps: [],
      });
      await refetch();
      onSelectWorkflow(newWorkflow);
      toast.success("Workflow created");
    } catch {
      toast.error("Failed to create workflow");
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    try {
      await workflowApi.deleteWorkflow(id);
      if (selectedWorkflowId === id) {
        onDeselectWorkflow();
      }
      await refetch();
      toast.success("Workflow deleted");
    } catch {
      toast.error("Failed to delete workflow");
    }
  };

  const handleDuplicateWorkflow = async (id: string) => {
    try {
      const duplicated = await workflowApi.duplicateWorkflow(id);
      await refetch();
      onSelectWorkflow(duplicated);
      toast.success("Workflow duplicated");
    } catch {
      toast.error("Failed to duplicate workflow");
    }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => workflowApi.deleteWorkflow(id)));
      if (selectedWorkflowId && ids.includes(selectedWorkflowId)) {
        onDeselectWorkflow();
      }
      await refetch();
      setSelectionMode(false);
      setSelectedIds(new Set());
      toast.success(`Deleted ${ids.length} workflow(s)`);
    } catch {
      toast.error("Failed to delete workflows");
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav id="workflow-list-sidebar" data-ui-element className="w-72 shrink-0 border-r border-border-subtle/50 flex flex-col h-full">
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Workflows
          </span>
          <div className="flex items-center gap-1">
            {workflows && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {workflows.length}
              </Badge>
            )}
            {selectionMode ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-red-400 hover:text-red-300"
                  disabled={selectedIds.size === 0}
                  onClick={handleBatchDelete}
                  title="Delete selected"
                >
                  <Trash2 className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}
                >
                  <X className="size-3" />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-text-muted"
                onClick={() => setSelectionMode(true)}
                disabled={!workflows || workflows.length === 0}
                title="Select for batch delete"
              >
                <CheckSquare className="size-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm bg-surface-raised/50 border-border-subtle"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs"
          onClick={handleCreateWorkflow}
        >
          <Plus className="size-3.5" />
          New Workflow
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-14 w-full bg-surface-raised/50 rounded-lg"
            />
          ))
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-xs text-red-400">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="py-6 text-center">
            <Workflow className="w-8 h-8 mx-auto mb-2 text-text-muted" />
            <p className="text-xs text-text-muted">
              {searchQuery ? "No matches" : "No workflows yet"}
            </p>
          </div>
        ) : (
          filteredWorkflows.map((workflow) => (
            <div key={workflow.id} className="group relative">
              <div
                className="flex items-center gap-2"
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (selectionMode) {
                    toggleSelection(workflow.id);
                  } else {
                    onSelectWorkflow(workflow);
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (() => {
                  if (selectionMode) {
                    toggleSelection(workflow.id);
                  } else {
                    onSelectWorkflow(workflow);
                  }
                })(); } }}
              >
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(workflow.id)}
                    onChange={() => toggleSelection(workflow.id)}
                    className="shrink-0 ml-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <WorkflowListItem
                    workflow={workflow}
                    isSelected={selectedWorkflowId === workflow.id}
                    onClick={() => {}}
                  />
                </div>
              </div>
              {!selectionMode && (
                <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-text-muted hover:text-green-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunWorkflow(workflow.id);
                    }}
                    title="Run workflow"
                  >
                    <Play className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-text-muted hover:text-text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateWorkflow(workflow.id);
                    }}
                  >
                    <Copy className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-text-muted hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteWorkflow(workflow.id);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
