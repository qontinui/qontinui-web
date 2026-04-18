"use client";

import React from "react";
import { Plus, Trash2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { StageTab } from "./_components/StageTab";
import { StageSettings } from "./_components/StageSettings";

/**
 * StageSelector -- renders a stage tab bar when the workflow has stages.
 * When no stages exist, shows a toggle to enable multi-stage mode.
 */
export function StageSelector() {
  const {
    state,
    currentStageIndex,
    currentStage,
    addStage,
    removeStage,
    selectStage,
    updateStage,
    moveStage,
    enableStages,
    disableStages,
    updateWorkflow,
  } = useWorkflowBuilder();

  const stages = state.workflow.stages;
  const hasStages = stages && stages.length > 0;

  if (!hasStages) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
          onClick={enableStages}
        >
          <Layers className="size-3 mr-1" />
          Enable Multi-Stage
        </Button>
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-800">
      {/* Stage tabs */}
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
        {stages.map((stage, index) => (
          <StageTab
            key={stage.id}
            name={stage.name}
            index={index}
            isActive={currentStageIndex === index}
            stepCount={
              (stage.setupSteps?.length ?? 0) +
              (stage.verificationSteps?.length ?? 0) +
              (stage.agenticSteps?.length ?? 0) +
              (stage.completionSteps?.length ?? 0)
            }
            onSelect={() => selectStage(index)}
            onRename={(name) => updateStage(index, { name })}
            onRemove={() => removeStage(index)}
            onMoveUp={index > 0 ? () => moveStage(index, "up") : undefined}
            onMoveDown={
              index < stages.length - 1
                ? () => moveStage(index, "down")
                : undefined
            }
          />
        ))}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 shrink-0"
          onClick={() => addStage(`Stage ${stages.length + 1}`)}
        >
          <Plus className="size-3" />
        </Button>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            Stop on failure
            <input
              type="checkbox"
              checked={state.workflow.stopOnFailure ?? false}
              onChange={(e) =>
                updateWorkflow({ stopOnFailure: e.target.checked })
              }
              className="size-3"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] text-zinc-500 hover:text-red-400"
            onClick={disableStages}
            title="Disable multi-stage (keeps Stage 1 steps)"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* Active stage settings */}
      {currentStage && currentStageIndex !== null && (
        <StageSettings
          stage={currentStage}
          onUpdate={(updates) => updateStage(currentStageIndex, updates)}
        />
      )}
    </div>
  );
}
