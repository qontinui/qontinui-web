"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useUIComponent } from "@qontinui/ui-bridge";
import { useWorkflowBuilder } from "@/components/workflow-builder/WorkflowBuilderContext";
import { StepConfigPanel } from "@/components/workflow-builder/StepConfigPanel";
import { SettingsPanel } from "@/components/workflow-builder/SettingsPanel";
import { ConstraintsPanel } from "@/components/workflow-builder/constraints";
import { ExecutionStatusPanel } from "@/components/workflow-builder/ExecutionStatusPanel";
import { StageSelector } from "@/components/workflow-builder/StageSelector";
import { AddStateStepsModal } from "@/components/workflow-builder/AddStateStepsModal";
import { CurlImportDialog } from "@/components/workflow-builder/CurlImportDialog";
import { GenerateFromStatesModal } from "@/components/workflow-builder/GenerateFromStatesModal";
import { Button } from "@/components/ui/button";
import { generateStepId, type UnifiedStep, type WorkflowPhase } from "@/types/unified-workflow";
import { PhaseStepRenderer } from "./PhaseStepRenderer";
import {
  Play,
  Download,
  Upload,
  Square,
  Save,
  Layers,
  Settings2,
  ShieldCheck,
  Terminal,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";

export function WorkflowEditor({
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
  const [showConstraints, setShowConstraints] = useState(false);
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

  // UI Bridge: Component-level actions for AI control
  useUIComponent({
    id: 'workflow-editor',
    name: 'Workflow Editor',
    description: 'Editor for building and managing workflow steps',
    actions: [
      {
        id: 'save',
        label: 'Save Workflow',
        handler: async () => {
          await handleSave();
        },
      },
      {
        id: 'run',
        label: 'Run Workflow',
        handler: async () => {
          if (hasUnsavedChanges) {
            const saved = await saveWorkflow();
            if (!saved) return;
          }
          onRun();
        },
      },
      {
        id: 'add-step',
        label: 'Add Step',
        handler: async () => {
          const step = {
            id: generateStepId(),
            phase: "verification" as const,
            type: "api" as const,
            name: "New Step",
          } as UnifiedStep;
          addStep(step, "verification");
        },
      },
    ],
  });

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
            onClick={() => {
              setShowConstraints(!showConstraints);
              if (!showConstraints) setShowSettings(false);
            }}
            title="Constraints"
          >
            <ShieldCheck className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              setShowSettings(!showSettings);
              if (!showSettings) setShowConstraints(false);
            }}
            title="Workflow settings"
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {showSettings && <SettingsPanel />}
      {showConstraints && <ConstraintsPanel />}

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
