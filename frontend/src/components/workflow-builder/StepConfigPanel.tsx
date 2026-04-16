"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkflowPhase } from "@/types/unified-workflow";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { CommandStepConfig } from "./_components/CommandStepConfig";
import { UiBridgeStepConfig } from "./_components/UiBridgeStepConfig";
import { PromptStepConfig } from "./_components/PromptStepConfig";

export function StepConfigPanel() {
  const { getSelectedStep, updateStep, selectStep } = useWorkflowBuilder();
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

  const stepConfig = (() => {
    switch (selectedStep.type) {
      case "command":
        return (
          <CommandStepConfig step={selectedStep} onUpdate={handleUpdate} />
        );
      case "ui_bridge":
        return (
          <UiBridgeStepConfig step={selectedStep} onUpdate={handleUpdate} />
        );
      case "prompt":
        return (
          <PromptStepConfig
            step={selectedStep}
            onUpdate={handleUpdate}
            phase={phase}
          />
        );
      default:
        return (
          <div className="text-zinc-500 text-sm p-4">
            Unknown step type: {(selectedStep as { type: string }).type}
          </div>
        );
    }
  })();

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
          {/* Skill Origin Badge */}
          {selectedStep.skill_origin && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-md">
              <span className="text-xs text-zinc-400">
                From skill:{" "}
                <span className="text-zinc-300 font-medium">
                  {/* skill_origin is typed as an opaque map on the wire; all
                      runner/web-produced origins include `skill_slug`. */}
                  {String(
                    (
                      selectedStep.skill_origin as
                        | { skill_slug?: string }
                        | undefined
                    )?.skill_slug ?? ""
                  )}
                </span>
              </span>
              <button
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={() => handleUpdate({ skill_origin: undefined })}
                title="Detach from skill — converts to raw step"
              >
                Detach
              </button>
            </div>
          )}

          {/* Common: Step name */}
          <div>
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Step Name
            </p>
            <input
              type="text"
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              value={selectedStep.name}
              onChange={(e) => handleUpdate({ name: e.target.value })}
            />
          </div>

          {/* Type-specific config */}
          {stepConfig}
        </div>
      </ScrollArea>
    </div>
  );
}
