"use client";

import { useState, useMemo, useCallback, useEffect, useRef, Suspense } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./workflows.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;
import { useRouter, useSearchParams } from "next/navigation";
import * as workflowApi from "@/lib/api/unified-workflows";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { runnerApi } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { WorkflowBuilderProvider, useWorkflowBuilder } from "@/components/workflow-builder/WorkflowBuilderContext";
import { PhaseSection } from "@/components/workflow-builder/PhaseSection";
import { StepItem } from "@/components/workflow-builder/StepItem";
import { AddStepDropdown } from "@/components/workflow-builder/AddStepDropdown";
import { StepConfigPanel } from "@/components/workflow-builder/StepConfigPanel";
import { SettingsPanel } from "@/components/workflow-builder/SettingsPanel";
import { AiGeneratePanel } from "@/components/workflow-builder/AiGeneratePanel";
import { ExecutionStatusPanel } from "@/components/workflow-builder/ExecutionStatusPanel";
import { StageSelector } from "@/components/workflow-builder/StageSelector";
import { AddStateStepsModal } from "@/components/workflow-builder/AddStateStepsModal";
import { CurlImportDialog } from "@/components/workflow-builder/CurlImportDialog";
import { GenerateFromStatesModal } from "@/components/workflow-builder/GenerateFromStatesModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createDefaultStep, generateStepId, type UnifiedStep, type UnifiedWorkflow, type WorkflowPhase } from "@/types/unified-workflow";
import { parseInsertStepParam } from "@/lib/insert-into-workflow";
import {
  Plus,
  Search,
  Workflow,
  Settings2,
  Trash2,
  Copy,
  Play,
  Download,
  Upload,
  Square,
  Save,
  Layers,
  X,
  CheckSquare,
  Terminal,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";

function WorkflowListItem({
  workflow,
  isSelected,
  onClick,
}: {
  workflow: UnifiedWorkflow;
  isSelected: boolean;
  onClick: () => void;
}) {
  const stepCount =
    (workflow.setup_steps?.length ?? 0) +
    (workflow.verification_steps?.length ?? 0) +
    (workflow.agentic_steps?.length ?? 0) +
    (workflow.completion_steps?.length ?? 0);

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? "bg-brand-primary/10 border-brand-primary/40"
          : "bg-surface-canvas/50 border-border-subtle/30 hover:border-border-default"
      }`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Workflow className="size-4 text-text-muted shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate">
          {workflow.name}
        </span>
      </div>
      {workflow.description && (
        <p className="text-xs text-text-muted line-clamp-2 ml-6">
          {workflow.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1.5 ml-6">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </Badge>
      </div>
    </div>
  );
}

function PhaseStepRenderer({
  phase,
  steps,
}: {
  phase: WorkflowPhase;
  steps: UnifiedStep[];
}) {
  const { state, selectStep, removeStep, duplicateStep, addStep } = useWorkflowBuilder();
  const [showAddStep, setShowAddStep] = useState(false);

  const handleQuickAddStep = useCallback(
    (type: string, targetPhase: WorkflowPhase) => {
      const step = createDefaultStep(type as UnifiedStep["type"], targetPhase);
      addStep(step, targetPhase);
    },
    [addStep]
  );

  const renderStep = useCallback(
    (step: UnifiedStep, index: number) => (
      <StepItem
        step={step}
        phase={phase}
        index={index}
        isSelected={state.selectedStepId === step.id}
        onDuplicate={() => duplicateStep(step.id, phase)}
        onDelete={() => removeStep(step.id, phase)}
        onClick={() => selectStep(step.id)}
      />
    ),
    [phase, state.selectedStepId, duplicateStep, removeStep, selectStep]
  );

  return (
    <>
      <PhaseSection
        phase={phase}
        steps={steps}
        onAddStep={() => setShowAddStep(true)}
        onQuickAddStep={handleQuickAddStep}
        renderStep={renderStep}
      />
      {showAddStep && (
        <AddStepDropdown
          phase={phase}
          isOpen={showAddStep}
          onClose={() => setShowAddStep(false)}
          onAddStep={addStep}
        />
      )}
    </>
  );
}

function WorkflowEditor({
  onRun,
  pendingInsertStep,
  onInsertConsumed,
}: {
  onRun: () => void;
  pendingInsertStep?: Partial<UnifiedStep> | null;
  onInsertConsumed?: () => void;
}) {
  const { state, addStep, saveWorkflow, exportWorkflow, importWorkflow, setWorkflow, hasUnsavedChanges, getActiveSteps } =
    useWorkflowBuilder();
  const [showSettings, setShowSettings] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showAddStateSteps, setShowAddStateSteps] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showGenerateFromStates, setShowGenerateFromStates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle pending insert step from builder pages
  useEffect(() => {
    if (pendingInsertStep && onInsertConsumed) {
      const phase: WorkflowPhase =
        (pendingInsertStep.phase as WorkflowPhase) || "verification";
      const step = {
        ...pendingInsertStep,
        id: generateStepId(),
        phase,
      } as UnifiedStep;
      addStep(step, phase);
      onInsertConsumed();
    }
  }, [pendingInsertStep, onInsertConsumed, addStep]);

  const handleSave = useCallback(async () => {
    const saved = await saveWorkflow();
    if (saved) {
      toast.success("Workflow saved");
    } else {
      toast.error("Failed to save workflow");
    }
  }, [saveWorkflow]);

  const handleExport = useCallback(async () => {
    try {
      const exportData = await exportWorkflow(state.workflow.id);
      if (!exportData) {
        toast.error("Failed to export workflow");
        return;
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileName = `${state.workflow.name || "workflow"}.json`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Workflow exported");
    } catch {
      toast.error("Failed to export workflow");
    }
  }, [exportWorkflow, state.workflow.id, state.workflow.name]);

  const handleImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        // Support both raw workflow and export-with-manifest format
        const workflowData = parsed.workflow ?? parsed;

        const result = await importWorkflow(workflowData);
        if (result) {
          setWorkflow(result.workflow);
          toast.success("Workflow imported");
        } else {
          toast.error("Failed to import workflow");
        }
      } catch {
        toast.error("Failed to parse workflow file");
      }

      // Reset file input so the same file can be re-imported
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [importWorkflow, setWorkflow],
  );

  const handleStop = useCallback(async () => {
    setIsStopping(true);
    try {
      const res = await fetch("http://localhost:9876/task-runs/running");
      if (!res.ok) {
        toast.error("Failed to fetch running tasks");
        return;
      }
      const runningTasks = await res.json();
      const matchingRun = Array.isArray(runningTasks)
        ? runningTasks.find(
            (run: { workflow_id?: string }) =>
              run.workflow_id === state.workflow.id,
          )
        : null;

      if (!matchingRun) {
        toast.info("No running task found for this workflow");
        return;
      }

      const stopRes = await fetch(
        `http://localhost:9876/task-runs/${matchingRun.id}/stop`,
        { method: "POST" },
      );
      if (stopRes.ok) {
        toast.success("Workflow execution stopped");
      } else {
        toast.error("Failed to stop workflow execution");
      }
    } catch {
      toast.error("Failed to stop workflow execution");
    } finally {
      setIsStopping(false);
    }
  }, [state.workflow.id]);

  return (
    <div className="flex-1 min-w-0 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">
          {state.workflow.name || "Untitled Workflow"}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="brand-primary"
            size="sm"
            className="h-8"
            onClick={async () => {
              if (hasUnsavedChanges) {
                const saved = await saveWorkflow();
                if (!saved) {
                  toast.error("Failed to save before running");
                  return;
                }
                toast.success("Workflow saved");
              }
              onRun();
            }}
          >
            <Play className="size-4" />
            Run
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={handleStop}
            disabled={isStopping}
            title="Stop running workflow"
          >
            <Square className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={handleSave}
            disabled={state.isSaving}
            title="Save workflow"
          >
            <Save className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={handleExport}
            title="Export workflow as JSON"
          >
            <Download className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => fileInputRef.current?.click()}
            title="Import workflow from JSON"
          >
            <Upload className="size-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowGenerateFromStates(true)}
            title="Generate workflow from state machine"
          >
            <GitBranch className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowAddStateSteps(true)}
            title="Add steps from state config"
          >
            <Layers className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowCurlImport(true)}
            title="Import from curl command"
          >
            <Terminal className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {showSettings && <SettingsPanel />}

      <ExecutionStatusPanel workflowId={state.workflow.id} />

      <StageSelector />

      <PhaseStepRenderer phase="setup" steps={getActiveSteps("setup")} />
      <PhaseStepRenderer phase="verification" steps={getActiveSteps("verification")} />
      <PhaseStepRenderer phase="agentic" steps={getActiveSteps("agentic")} />
      <PhaseStepRenderer phase="completion" steps={getActiveSteps("completion")} />

      {state.selectedStepId && <StepConfigPanel />}

      <AddStateStepsModal
        isOpen={showAddStateSteps}
        onClose={() => setShowAddStateSteps(false)}
        onAddSteps={(steps) => {
          for (const { step, phase } of steps) {
            addStep(step, phase);
          }
          toast.success(`Added ${steps.length} step(s) from state config`);
        }}
      />

      <CurlImportDialog
        isOpen={showCurlImport}
        onClose={() => setShowCurlImport(false)}
        onImport={(step, phase) => {
          addStep(step, phase);
          toast.success("Curl command imported as step");
        }}
      />

      <GenerateFromStatesModal
        isOpen={showGenerateFromStates}
        onClose={() => setShowGenerateFromStates(false)}
        onWorkflowGenerated={(generated) => {
          // Apply generated steps to the current workflow
          if (generated.setup_steps) {
            for (const step of generated.setup_steps) addStep(step, "setup");
          }
          if (generated.verification_steps) {
            for (const step of generated.verification_steps) addStep(step, "verification");
          }
          if (generated.agentic_steps) {
            for (const step of generated.agentic_steps) addStep(step, "agentic");
          }
          if (generated.completion_steps) {
            for (const step of generated.completion_steps) addStep(step, "completion");
          }
          toast.success(`Generated workflow with ${(generated.setup_steps?.length ?? 0) + (generated.verification_steps?.length ?? 0) + (generated.agentic_steps?.length ?? 0) + (generated.completion_steps?.length ?? 0)} steps`);
        }}
      />
    </div>
  );
}

function WorkflowListSidebar({
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
    <nav id="workflow-list-sidebar" data-ui-id="workflow-list-sidebar" data-ui-element className="w-72 shrink-0 border-r border-border-subtle/50 flex flex-col h-full">
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

function BuildWorkflowsPageContent() {
  usePageSpecs({ workflows: pageSpec });
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isOffline } = useUnifiedWorkflows();
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<UnifiedWorkflow | null>(null);
  const [isCreatingManually, setIsCreatingManually] = useState(false);
  const [pendingInsertStep, setPendingInsertStep] = useState<Partial<UnifiedStep> | null>(null);

  // Handle insertStep query parameter from builder pages
  useEffect(() => {
    const insertParam = searchParams.get("insertStep");
    if (insertParam) {
      const stepData = parseInsertStepParam(insertParam);
      if (stepData) {
        setPendingInsertStep(stepData);
        // Clean URL
        router.replace("/build/workflows");
      }
    }
  }, [searchParams, router]);

  // When we have a pending insert step and a workflow is selected, add it
  useEffect(() => {
    if (pendingInsertStep && selectedWorkflow) {
      // Will be handled by WorkflowEditor via the pendingInsertStep prop
    }
  }, [pendingInsertStep, selectedWorkflow]);

  // Auto-create workflow when insert step arrives without a selected workflow
  useEffect(() => {
    if (pendingInsertStep && !selectedWorkflow && !isCreatingManually) {
      (async () => {
        setIsCreatingManually(true);
        try {
          const newWorkflow = await workflowApi.createWorkflow({
            name: "New Workflow",
            description: "",
            setup_steps: [],
            verification_steps: [],
            agentic_steps: [],
            completion_steps: [],
          });
          setSelectedWorkflow(newWorkflow);
        } catch {
          toast.error("Failed to create workflow");
          setPendingInsertStep(null);
        } finally {
          setIsCreatingManually(false);
        }
      })();
    }
  }, [pendingInsertStep, selectedWorkflow, isCreatingManually]);

  const handleCreateManually = async () => {
    setIsCreatingManually(true);
    try {
      const newWorkflow = await workflowApi.createWorkflow({
        name: "New Workflow",
        description: "",
        setup_steps: [],
        verification_steps: [],
        agentic_steps: [],
        completion_steps: [],
      });
      setSelectedWorkflow(newWorkflow);
    } catch {
      toast.error("Failed to create workflow");
    } finally {
      setIsCreatingManually(false);
    }
  };

  const handleRunWorkflow = async (workflowId: string) => {
    try {
      await runnerApi.runWorkflow(workflowId);
      toast.success("Workflow started!");
      router.push("/runs/active");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start workflow"
      );
    }
  };

  const handleNavigateToActiveRuns = (_taskRunId: string) => {
    router.push("/runs/active");
  };

  return (
    <div className="h-full bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Workflow className="size-5 text-brand-secondary" />
            <h1 className="text-lg font-bold text-text-primary">
              Workflow Builder
            </h1>
          </div>
        </div>
      </header>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <WorkflowListSidebar
          selectedWorkflowId={selectedWorkflow?.id ?? null}
          onSelectWorkflow={setSelectedWorkflow}
          onDeselectWorkflow={() => setSelectedWorkflow(null)}
          onRunWorkflow={handleRunWorkflow}
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          {isOffline ? (
            <RunnerOfflineState />
          ) : selectedWorkflow ? (
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-muted"
                  onClick={() => setSelectedWorkflow(null)}
                >
                  Back to AI Generator
                </Button>
              </div>
              <WorkflowBuilderProvider
                key={selectedWorkflow.id}
                initialWorkflow={selectedWorkflow}
              >
                <WorkflowEditor
                  onRun={() => handleRunWorkflow(selectedWorkflow.id)}
                  pendingInsertStep={pendingInsertStep}
                  onInsertConsumed={() => setPendingInsertStep(null)}
                />
              </WorkflowBuilderProvider>
            </div>
          ) : (
            <AiGeneratePanel
              onCreateManually={handleCreateManually}
              isCreatingManually={isCreatingManually}
              onNavigateToActiveRuns={handleNavigateToActiveRuns}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function BuildWorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <BuildWorkflowsPageContent />
    </Suspense>
  );
}
