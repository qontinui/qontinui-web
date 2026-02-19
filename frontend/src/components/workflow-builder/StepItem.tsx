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
  ChevronUp,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  UnifiedStep,
  WorkflowPhase,
  PromptStep,
  TestStep,
  CommandStep,
  UiBridgeStep,
} from "@/types/unified-workflow";

const STEP_ICONS: Record<string, React.ElementType> = {
  command: Terminal,
  test: TestTube2,
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
  if (step.type === "test")
    return TEST_ICONS[(step as TestStep).test_type] ?? TestTube2;
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
      if (cmd.check_type) return cmd.check_type.replace(/_/g, " ");
      if (cmd.check_group_id) return `Group: ${cmd.check_group_id}`;
      return cmd.command
        ? cmd.command.slice(0, 60) + (cmd.command.length > 60 ? "..." : "")
        : "";
    }
    case "test":
      return (step as TestStep).test_type.replace(/_/g, " ");
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
  isFirst: boolean;
  isLast: boolean;
  isSelected: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function StepItem({
  step,
  phase: _phase,
  index: _index,
  isFirst,
  isLast,
  isSelected,
  onMoveUp,
  onMoveDown,
  onDelete,
  onClick,
}: StepItemProps) {
  const Icon = getStepIcon(step);
  const subtitle = getStepSubtitle(step);
  const isSummaryStep =
    step.type === "prompt" && (step as PromptStep).is_summary_step;

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isSelected
          ? "bg-zinc-700/80 ring-1 ring-zinc-500"
          : "hover:bg-zinc-800/60"
      }`}
      onClick={onClick}
    >
      <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
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
              onMoveUp();
            }}
            disabled={isFirst}
          >
            <ChevronUp className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            disabled={isLast}
          >
            <ChevronDown className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
