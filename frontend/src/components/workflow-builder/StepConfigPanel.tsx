"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkflowPhase } from "@/types/unified-workflow";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";

// Step config imports
import { PromptConfig } from "./step-configs/PromptConfig";
import { ShellCommandConfig } from "./step-configs/ShellCommandConfig";
import { ScriptConfig } from "./step-configs/ScriptConfig";
import { StateConfig } from "./step-configs/StateConfig";
import { CheckConfig } from "./step-configs/CheckConfig";
import { CheckGroupConfig } from "./step-configs/CheckGroupConfig";
import { TestConfig } from "./step-configs/TestConfig";
import { WorkflowRefConfig } from "./step-configs/WorkflowRefConfig";
import { MacroRefConfig } from "./step-configs/MacroRefConfig";
import { GuiActionConfig } from "./step-configs/GuiActionConfig";
import { ApiRequestConfig } from "./step-configs/ApiRequestConfig";
import { McpCallConfig } from "./step-configs/McpCallConfig";
import { ScreenshotConfig } from "./step-configs/ScreenshotConfig";
import { GateConfig } from "./step-configs/GateConfig";
import { SpecConfig } from "./step-configs/SpecConfig";
import { AwasConfigs } from "./step-configs/AwasConfigs";
import { SaveWorkflowArtifactConfig } from "./step-configs/SaveWorkflowArtifactConfig";

export function StepConfigPanel() {
  const { getSelectedStep, updateStep, selectStep, state } =
    useWorkflowBuilder();
  const selectedStep = getSelectedStep();

  if (!selectedStep) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Select a step to configure
      </div>
    );
  }

  const phase = selectedStep.phase as WorkflowPhase;

  const handleUpdate = (updates: Record<string, unknown>) => {
    updateStep({ ...selectedStep, ...updates } as typeof selectedStep, phase);
  };

  const renderConfig = () => {
    switch (selectedStep.type) {
      case "prompt":
        return (
          <PromptConfig
            step={selectedStep}
            onUpdate={handleUpdate}
            phase={phase}
          />
        );
      case "shell_command":
        return (
          <ShellCommandConfig
            step={selectedStep}
            onUpdate={handleUpdate}
            phase={phase}
          />
        );
      case "script":
        return <ScriptConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "state":
        return <StateConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "check":
        return <CheckConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "check_group":
        return <CheckGroupConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "test":
        return <TestConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "workflow_ref":
        return (
          <WorkflowRefConfig step={selectedStep} onUpdate={handleUpdate} />
        );
      case "macro":
        return <MacroRefConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "gui_action":
        return <GuiActionConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "api_request":
        return <ApiRequestConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "mcp_call":
        return <McpCallConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "screenshot":
        return <ScreenshotConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "gate":
        return (
          <GateConfig
            step={selectedStep}
            onUpdate={handleUpdate}
            workflow={state.workflow}
          />
        );
      case "spec":
        return <SpecConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "awas_discover":
      case "awas_execute":
      case "awas_check_support":
      case "awas_list_actions":
      case "awas_extract_elements":
        return <AwasConfigs step={selectedStep} onUpdate={handleUpdate} />;
      case "save_workflow_artifact":
        return (
          <SaveWorkflowArtifactConfig
            step={selectedStep}
            onUpdate={handleUpdate}
          />
        );
      default:
        return (
          <div className="text-zinc-500 text-sm p-4">
            Unknown step type: {(selectedStep as { type: string }).type}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-200">
          Step Configuration
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => selectStep(null)}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Common: Step name */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Step Name
            </label>
            <input
              type="text"
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              value={selectedStep.name}
              onChange={(e) => handleUpdate({ name: e.target.value })}
            />
          </div>

          {/* Type-specific config */}
          {renderConfig()}
        </div>
      </ScrollArea>
    </div>
  );
}
