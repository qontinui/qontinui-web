import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Terminal,
  Bot,
  Globe2,
  FileCode,
  GitBranch,
  Plug,
  Monitor,
  FlaskConical,
  Camera,
  MousePointer,
  Network,
  Layers,
  Repeat,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export type StepType =
  | "workflow"
  | "state"
  | "action"
  | "screenshot"
  | "gui_action"
  | "workflow_ref"
  | "playwright"
  | "test"
  | "check"
  | "check_group"
  | "shell"
  | "api_request"
  | "mcp_call"
  | "prompt"
  | "ai_session"
  | "awas"
  | "macro"
  | "script"
  | "unknown";

export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "unknown";

export type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

export interface TimelineStep {
  id: string;
  type: StepType;
  name: string;
  status: StepStatus;
  phase: WorkflowPhase;
  stageIndex: number;
  stepIndex: number;
  iteration?: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  error?: string;
}

export interface IterationGroup {
  iteration: number;
  steps: TimelineStep[];
  isActive: boolean;
  isComplete: boolean;
  stats: {
    total: number;
    completed: number;
    successful: number;
    failed: number;
  };
}

export interface PhaseGroup {
  phase: WorkflowPhase;
  /** Stage index this phase belongs to (for multi-stage grouping) */
  stageIndex: number;
  /** Display label (includes stage prefix for multi-stage) */
  displayLabel: string;
  steps: TimelineStep[];
  iterationGroups: IterationGroup[];
  hasIterations: boolean;
  isActive: boolean;
  isComplete: boolean;
  stats: {
    total: number;
    completed: number;
    successful: number;
    failed: number;
  };
}

export interface TimelineStats {
  elapsedTime: number;
  currentIteration: number | null;
  maxIteration: number;
  avgIterationDurationMs: number | null;
  verificationResults: {
    iteration: number;
    passed: number;
    total: number;
    isComplete: boolean;
  }[];
  improvement: { delta: number; total: number; percentage: number } | null;
}

// =============================================================================
// Constants
// =============================================================================

export const PHASE_ORDER: WorkflowPhase[] = [
  "setup",
  "verification",
  "agentic",
  "completion",
];

export const PHASE_CONFIG: Record<
  WorkflowPhase,
  {
    label: string;
    color: string;
    textColor: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  setup: {
    label: "Setup",
    color: "blue",
    textColor: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  verification: {
    label: "Verification",
    color: "purple",
    textColor: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
  },
  agentic: {
    label: "Agentic",
    color: "green",
    textColor: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
  completion: {
    label: "Completion",
    color: "teal",
    textColor: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/30",
  },
};

export const STEP_ICONS: Record<StepType, LucideIcon> = {
  workflow: Layers,
  state: Network,
  action: MousePointer,
  screenshot: Camera,
  gui_action: Monitor,
  workflow_ref: GitBranch,
  playwright: Globe2,
  test: FlaskConical,
  check: CheckCircle2,
  check_group: FlaskConical,
  shell: Terminal,
  api_request: Globe2,
  mcp_call: Plug,
  prompt: Bot,
  ai_session: Bot,
  awas: Network,
  macro: Repeat,
  script: FileCode,
  unknown: FileCode,
};

export const STEP_COLORS: Record<
  StepType,
  { text: string; bg: string; border: string }
> = {
  workflow: {
    text: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  state: {
    text: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  action: {
    text: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  screenshot: {
    text: "text-sky-300",
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
  },
  gui_action: {
    text: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  workflow_ref: {
    text: "text-pink-300",
    bg: "bg-pink-500/10",
    border: "border-pink-500/30",
  },
  playwright: {
    text: "text-purple-300",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  test: {
    text: "text-teal-300",
    bg: "bg-teal-500/10",
    border: "border-teal-500/30",
  },
  check: {
    text: "text-teal-300",
    bg: "bg-teal-500/10",
    border: "border-teal-500/30",
  },
  check_group: {
    text: "text-teal-300",
    bg: "bg-teal-500/10",
    border: "border-teal-500/30",
  },
  shell: {
    text: "text-slate-300",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
  },
  api_request: {
    text: "text-orange-300",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
  },
  mcp_call: {
    text: "text-violet-300",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
  prompt: {
    text: "text-green-300",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
  },
  ai_session: {
    text: "text-green-300",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
  },
  awas: {
    text: "text-cyan-300",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
  },
  macro: {
    text: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  script: {
    text: "text-indigo-300",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/30",
  },
  unknown: {
    text: "text-zinc-300",
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/30",
  },
};
