"use client";

import { useState, useMemo } from "react";
import { useUIComponent } from "@qontinui/ui-bridge";
import * as workflowApi from "@/lib/api/unified-workflows";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { useRunnerHealth } from "@/lib/runner/hooks/misc-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
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
  onCreatingChange,
}: {
  selectedWorkflowId: string | null;
  onSelectWorkflow: (workflow: UnifiedWorkflow) => void;
  onDeselectWorkflow: () => void;
  onRunWorkflow: (workflowId: string) => void;
  onCreatingChange?: (creating: boolean) => void;
}) {
  // The list comes from the WEB canonical store (`/api/v1/unified-workflows`)
  // — authoring never needs a co-located runner. Create/save/duplicate/delete
  // all route through the same web client via workflowApi below.
  const {
    data: workflows,
    isLoading,
    error,
    refetch,
  } = useUnifiedWorkflows();
  // Runner health gates ONLY execution (Run / dispatch). When no runner is
  // connected, dispatch would fail, so we surface the per-row Run button as
  // visibly-disabled with a tooltip rather than letting the click hit a dead
  // endpoint. Save/Create/Export/Import/editing stay enabled regardless.
  const { data: runnerHealth, isOffline: runnerHealthOffline } =
    useRunnerHealth();
  const runnerIsOffline = runnerHealthOffline || !runnerHealth;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    const filtered = !searchQuery.trim()
      ? workflows
      : workflows.filter((w) =>
          w.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    return filtered;
  }, [workflows, searchQuery]);

  // The web list already carries the full canonical UnifiedWorkflow, so a
  // selected row can be handed straight to the editor — no detail fetch.
  const handleSelect = (workflow: UnifiedWorkflow) => {
    onSelectWorkflow(workflow);
  };

  const handleCreateWorkflow = async () => {
    onCreatingChange?.(true);
    try {
      // Authoring flows through the web canonical store; no runner needed.
      const newWorkflow = await workflowApi.createWorkflow({
        name: "New Workflow",
        description: "",
        setupSteps: [],
        verificationSteps: [],
        agenticSteps: [],
        completionSteps: [],
      });
      await refetch();
      onSelectWorkflow(newWorkflow);
      toast.success("Workflow created");
    } catch {
      toast.error("Failed to create workflow");
    } finally {
      onCreatingChange?.(false);
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
    } catch (err) {
      console.error("[WorkflowListSidebar] Delete failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to delete workflow"
      );
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

  // UI Bridge: Component-level actions for AI control
  useUIComponent({
    id: 'workflow-list-sidebar',
    name: 'Workflow List Sidebar',
    description: 'Sidebar for browsing, creating, and managing workflows',
    actions: [
      {
        id: 'create-workflow',
        label: 'Create Workflow',
        handler: async () => {
          await handleCreateWorkflow();
        },
      },
      {
        id: 'delete-workflow',
        label: 'Delete Workflow',
        handler: async () => {
          if (!selectedWorkflowId) {
            console.warn("[WorkflowListSidebar] Cannot delete: no workflow selected");
            return;
          }
          await handleDeleteWorkflow(selectedWorkflowId);
        },
      },
      {
        id: 'select-workflow',
        label: 'Select Workflow',
        handler: async () => {
          // Selects the first available workflow from the (filtered) list.
          // Limitation: the UI Bridge action system does not currently support
          // passing parameters, so we cannot accept a specific workflow ID here.
          // To select a specific workflow, use the sidebar UI directly.
          if (filteredWorkflows.length > 0) {
            handleSelect(filteredWorkflows[0]!);
          } else {
            console.warn("[WorkflowListSidebar] Cannot select: no workflows available");
          }
        },
      },
    ],
  });

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
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0${!workflows ? ' invisible' : ''}`}>
              {workflows?.length ?? 0}
            </Badge>
            <div className="flex items-center gap-1 min-w-[60px] justify-end">
              {selectionMode ? (
                <>
                  <DestructiveButton
                    size="icon"
                    className="h-6 w-6 text-red-400 hover:text-red-300"
                    disabled={selectedIds.size === 0}
                    onClick={handleBatchDelete}
                    title="Delete selected"
                  >
                    <Trash2 className="size-3" />
                  </DestructiveButton>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}
                  >
                    <X className="size-3" />
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-text-muted"
                  onClick={() => setSelectionMode(true)}
                  disabled={!workflows || workflows.length === 0}
                  title="Select for batch delete"
                >
                  <CheckSquare className="size-3" />
                </Button>
              )}
            </div>
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
                    handleSelect(workflow);
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (() => {
                  if (selectionMode) {
                    toggleSelection(workflow.id);
                  } else {
                    handleSelect(workflow);
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
                    className="h-5 w-5 text-text-muted hover:text-green-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={runnerIsOffline}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunWorkflow(workflow.id);
                    }}
                    title={
                      runnerIsOffline
                        ? "Connect a runner to run this workflow"
                        : "Run workflow"
                    }
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
