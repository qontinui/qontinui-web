"use client";

/**
 * SpecWorkflowBuilder
 *
 * Creates workflow-driven test specifications from page analysis data.
 * Accepts element lists from a page analyzer and allows the user to
 * compose ordered test steps (navigate, interact, assert, wait, screenshot)
 * that reference discovered elements.
 *
 * Layout:
 *   Left panel  - ordered step list with add / remove / reorder
 *   Right panel - dynamic step editor based on selected step type
 *   Bottom bar  - "Generate Test Code" action + code preview
 */

import React from "react";
import { Plus, ShieldCheck, Code, Copy, Check, Play } from "lucide-react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type {
  AnalyzedElement,
  SpecStep,
  SpecStepType,
} from "./spec-workflow-types";
import { STEP_TYPE_META } from "./spec-workflow-types";
import { SortableStepItem } from "./_components/SortableStepItem";
import { StepEditor } from "./_components/StepEditor";
import { useSpecWorkflowBuilder } from "./_hooks/useSpecWorkflowBuilder";

// Re-export types that external consumers depend on
export type {
  AnalyzedElement,
  SpecStep,
  SpecStepType,
  InteractionAction,
  AssertionKind,
  WaitCondition,
  NavigateStep,
  InteractStep,
  AssertStep,
  WaitStep,
  ScreenshotStep,
} from "./spec-workflow-types";

// ---------------------------------------------------------------------------
// SpecWorkflowBuilder (main component)
// ---------------------------------------------------------------------------

export interface SpecWorkflowBuilderProps {
  /** Elements discovered by the page analyzer */
  elements: AnalyzedElement[];
  /** Called when the user clicks "Generate Test Code" */
  onGenerate?: (code: string, steps: SpecStep[]) => void;
  /** Optional initial steps to pre-populate */
  initialSteps?: SpecStep[];
  /** Optional class name */
  className?: string;
}

export function SpecWorkflowBuilder({
  elements,
  onGenerate,
  initialSteps,
  className,
}: SpecWorkflowBuilderProps) {
  const {
    steps,
    selectedStepId,
    selectedStep,
    showCode,
    copied,
    generatedCode,
    sensors,
    setSelectedStepId,
    setShowCode,
    addStep,
    updateStep,
    deleteStep,
    moveStep,
    handleDragEnd,
    handleCopy,
    handleGenerate,
  } = useSpecWorkflowBuilder({ elements, initialSteps, onGenerate });

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-zinc-900 rounded-lg border border-zinc-700 overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-zinc-200">
            Spec Workflow Builder
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
            {elements.length} element{elements.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Main content: step list (left) + editor (right) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left panel: step list */}
        <div className="w-72 flex flex-col border-r border-zinc-700 shrink-0">
          {/* Add step buttons */}
          <div className="p-2 border-b border-zinc-800 bg-zinc-800/30">
            <div className="flex flex-wrap gap-1">
              {(
                Object.entries(STEP_TYPE_META) as [
                  SpecStepType,
                  (typeof STEP_TYPE_META)[SpecStepType],
                ][]
              ).map(([type, meta]) => {
                const Icon = meta.icon;
                return (
                  <Button
                    key={type}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => addStep(type)}
                    title={`Add ${meta.label} step`}
                  >
                    <Plus className="w-3 h-3" />
                    <Icon className={cn("w-3 h-3", meta.color)} />
                    <span className="text-zinc-400">{meta.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Step list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-1">
              {steps.length === 0 && (
                <div className="text-center py-8 text-zinc-500 text-xs">
                  No steps yet. Add a step above.
                </div>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={steps.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {steps.map((step, i) => (
                    <SortableStepItem
                      key={step.id}
                      step={step}
                      index={i}
                      isSelected={selectedStepId === step.id}
                      onSelect={() => setSelectedStepId(step.id)}
                      onMoveUp={() => moveStep(i, -1)}
                      onMoveDown={() => moveStep(i, 1)}
                      onDelete={() => deleteStep(step.id)}
                      isFirst={i === 0}
                      isLast={i === steps.length - 1}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </ScrollArea>
        </div>

        {/* Right panel: step editor or code preview */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {showCode ? (
            /* Code preview */
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800/30">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-medium text-zinc-300">
                    Generated Playwright Test
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowCode(false)}
                  >
                    Back to editor
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <pre className="p-4 text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                  {generatedCode}
                </pre>
              </ScrollArea>
            </div>
          ) : selectedStep ? (
            /* Step editor */
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-700 bg-zinc-800/30">
                {React.createElement(STEP_TYPE_META[selectedStep.type].icon, {
                  className: cn(
                    "w-4 h-4",
                    STEP_TYPE_META[selectedStep.type].color
                  ),
                })}
                <span className="text-xs font-medium text-zinc-300">
                  Edit {STEP_TYPE_META[selectedStep.type].label} Step
                </span>
                <Badge variant="outline" className="text-[10px] ml-auto">
                  #{steps.findIndex((s) => s.id === selectedStep.id) + 1}
                </Badge>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-4">
                  <StepEditor
                    step={selectedStep}
                    elements={elements}
                    onChange={updateStep}
                  />
                </div>
              </ScrollArea>
            </div>
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <ShieldCheck className="w-10 h-10 text-zinc-700 mx-auto" />
                <p className="text-sm text-zinc-500">
                  Select a step to edit, or add a new step.
                </p>
                <p className="text-xs text-zinc-600">
                  {elements.length > 0
                    ? `${elements.length} page elements available for reference.`
                    : "No page elements loaded. Run the page analyzer first."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer: generate button */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-700 bg-zinc-800/50">
        <div className="text-xs text-zinc-500">
          {steps.length > 0
            ? `${steps.length} step${steps.length !== 1 ? "s" : ""} configured`
            : "Add steps to build a test specification"}
        </div>
        <div className="flex items-center gap-2">
          {showCode && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setShowCode(false)}
            >
              Edit Steps
            </Button>
          )}
          <Button
            variant="brand-primary"
            size="sm"
            disabled={steps.length === 0}
            onClick={handleGenerate}
            className="gap-1.5"
          >
            <Code className="w-3.5 h-3.5" />
            Generate Test Code
          </Button>
        </div>
      </div>
    </div>
  );
}
