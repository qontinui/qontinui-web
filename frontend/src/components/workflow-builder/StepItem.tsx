"use client";

import React from "react";
import {
  FileCode,
  Navigation,
  GitBranch,
  Layers,
  MousePointer2,
  Globe,
  Bot,
  Terminal,
  Plug,
  TestTube2,
  Eye,
  Code,
  Package,
  AlertTriangle,
  AlignLeft,
  FileType,
  Search,
  Shield,
  Camera,
  MessageSquare,
  ShieldCheck,
  Lock,
  ChevronUp,
  ChevronDown,
  Trash2,
  Play,
  List,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  UnifiedStep,
  WorkflowPhase,
  PromptStep,
  GuiActionStep,
  TestStep,
  CheckStep,
} from "@/types/unified-workflow";

const STEP_ICONS: Record<string, React.ElementType> = {
  script: FileCode,
  state: Navigation,
  workflow_ref: GitBranch,
  macro: Layers,
  gui_action: MousePointer2,
  api_request: Globe,
  prompt: Bot,
  shell_command: Terminal,
  mcp_call: Plug,
  test: TestTube2,
  check: AlertTriangle,
  check_group: ShieldCheck,
  screenshot: Camera,
  spec: ShieldCheck,
  gate: ShieldCheck,
  awas_discover: Search,
  awas_execute: Play,
  awas_check_support: CheckCircle,
  awas_list_actions: List,
  awas_extract_elements: Search,
};

const TEST_ICONS: Record<string, React.ElementType> = {
  playwright: TestTube2,
  qontinui_vision: Eye,
  python: Code,
  repository: Package,
  custom_command: Terminal,
};

const CHECK_ICONS: Record<string, React.ElementType> = {
  lint: AlertTriangle,
  format: AlignLeft,
  typecheck: FileType,
  analyze: Search,
  security: Shield,
  custom_command: Terminal,
};

function getStepIcon(step: UnifiedStep): React.ElementType {
  if (step.type === "test")
    return TEST_ICONS[(step as TestStep).test_type] ?? TestTube2;
  if (step.type === "check")
    return CHECK_ICONS[(step as CheckStep).check_type] ?? AlertTriangle;
  if (step.type === "prompt") {
    if (step.phase === "agentic") return MessageSquare;
    return Bot;
  }
  return STEP_ICONS[step.type] ?? Bot;
}

function getStepSubtitle(step: UnifiedStep): string {
  switch (step.type) {
    case "script":
      return step.target_url
        ? `URL: ${step.target_url}`
        : step.script_id
          ? "Saved script"
          : "Inline script";
    case "state":
      return step.state_name ?? step.state_id ?? "";
    case "workflow_ref":
      return step.workflow_name ?? step.workflow_id ?? "";
    case "macro":
      return step.macro_name ?? step.macro_id ?? "";
    case "gui_action": {
      const s = step as GuiActionStep;
      if (s.action === "type") return `Type: "${s.text_input ?? ""}"`;
      if (s.action === "hotkey") return `Hotkey: ${s.hotkey ?? ""}`;
      if (s.action === "scroll")
        return `Scroll ${s.scroll_direction ?? "down"}`;
      return s.target_image_names?.join(", ") ?? s.action;
    }
    case "api_request":
      return `${step.method} ${step.url || "(no URL)"}`;
    case "prompt":
      return step.content
        ? step.content.slice(0, 60) + (step.content.length > 60 ? "..." : "")
        : "";
    case "shell_command":
      return step.command ? step.command.slice(0, 60) : "";
    case "mcp_call":
      return `${step.server_name ?? step.server_id}::${step.tool_name}`;
    case "test":
      return (step as TestStep).test_type.replace(/_/g, " ");
    case "check":
      return `${(step as CheckStep).check_type} ${(step as CheckStep).tool ? `(${(step as CheckStep).tool})` : ""}`.trim();
    case "check_group":
      return step.check_group_id;
    case "screenshot":
      return step.monitor ? `Monitor: ${step.monitor}` : "All monitors";
    case "gate":
      return `${step.required_steps.length} required step(s)`;
    case "spec":
      return step.description ?? "";
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
