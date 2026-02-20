"use client";

import React from "react";
import {
  Bot,
  Terminal,
  TestTube2,
  Eye,
  Code,
  Package,
  MessageSquare,
  Monitor,
  Lock,
  Trash2,
  Copy,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  UnifiedStep,
  WorkflowPhase,
  PromptStep,
  CommandStep,
  UiBridgeStep,
} from "@/types/unified-workflow";
import { getStepValidationIssues } from "@/lib/step-validation";

const STEP_ICONS: Record<string, React.ElementType> = {
  command: Terminal,
  ui_bridge: Monitor,
  prompt: Bot,
};

const TEST_ICONS: Record<string, React.ElementType> = {
  playwright: TestTube2,
  qontinui_vision: Eye,
  python: Code,
  repository: Package,
  custom_command: Terminal,
};

function getStepIcon(step: UnifiedStep): React.ElementType {
  if (step.type === "command") {
    const cmd = step as CommandStep;
    if (cmd.test_type || cmd.test_id)
      return TEST_ICONS[cmd.test_type ?? ""] ?? TestTube2;
  }
  if (step.type === "prompt") {
    if (step.phase === "agentic") return MessageSquare;
    return Bot;
  }
  return STEP_ICONS[step.type] ?? Bot;
}

function getStepSubtitle(step: UnifiedStep): string {
  switch (step.type) {
    case "command": {
      const cmd = step as CommandStep;
      if (cmd.test_type) return cmd.test_type.replace(/_/g, " ");
      if (cmd.test_id) return `Test: ${cmd.test_id}`;
      if (cmd.check_type) return cmd.check_type.replace(/_/g, " ");
      if (cmd.check_group_id) return `Group: ${cmd.check_group_id}`;
      return cmd.command
        ? cmd.command.slice(0, 60) + (cmd.command.length > 60 ? "..." : "")
        : "";
    }
    case "ui_bridge": {
      const ub = step as UiBridgeStep;
      return ub.action ?? "";
    }
    case "prompt":
      return step.content
        ? step.content.slice(0, 60) + (step.content.length > 60 ? "..." : "")
        : "";
    default:
      return "";
  }
}

interface StepItemProps {
  step: UnifiedStep;
  phase: WorkflowPhase;
  index: number;
  isSelected: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function StepItem({
  step,
  phase: _phase,
  index: _index,
  isSelected,
  onDuplicate,
  onDelete,
  onClick,
}: StepItemProps) {
  const Icon = getStepIcon(step);
  const subtitle = getStepSubtitle(step);
  const isSummaryStep =
    step.type === "prompt" && (step as PromptStep).is_summary_step;

  const issues = getStepValidationIssues(step);
  const hasErrors = issues.some((i) => i.severity === "error");
  const hasWarnings = issues.some((i) => i.severity === "warning");
  const validationTooltip = issues.map((i) => i.message).join("; ");

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id, disabled: !!isSummaryStep });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isDragging ? "opacity-50" : ""
      } ${
        isSelected
          ? "bg-zinc-700/80 ring-1 ring-zinc-500"
          : "hover:bg-zinc-800/60"
      }`}
      onClick={onClick}
    >
      {!isSummaryStep && (
        <button
          className="touch-none cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 shrink-0"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="relative shrink-0">
        <Icon className="w-4 h-4 text-zinc-400" />
        {(hasErrors || hasWarnings) && (
          <span
            className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${
              hasErrors ? "bg-red-500" : "bg-amber-500"
            }`}
            title={validationTooltip}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-zinc-200 truncate">{step.name}</span>
          {isSummaryStep && <Lock className="w-3 h-3 text-zinc-500" />}
        </div>
        {subtitle && (
          <p className="text-xs text-zinc-500 truncate">{subtitle}</p>
        )}
      </div>
      {!isSummaryStep && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            title="Duplicate step"
          >
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete step"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
