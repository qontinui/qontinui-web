"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import type { CurrentExecutionStep } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Timer,
  TrendingUp,
  TrendingDown,
  Minus,
  // Step type icons
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

type StepType =
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

type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "unknown";

type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

interface TimelineStep {
  id: string;
  type: StepType;
  name: string;
  status: StepStatus;
  phase: WorkflowPhase;
  stepIndex: number;
  iteration?: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  error?: string;
}

interface IterationGroup {
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

interface PhaseGroup {
  phase: WorkflowPhase;
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

interface TimelineStats {
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

const PHASE_ORDER: WorkflowPhase[] = [
  "setup",
  "verification",
  "agentic",
  "completion",
];

const PHASE_CONFIG: Record<
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
    color: "amber",
    textColor: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
  },
};

// =============================================================================
// Helpers
// =============================================================================

function mapStepType(apiType: string): StepType {
  const typeMap: Record<string, StepType> = {
    workflow: "workflow",
    gui_workflow: "workflow",
    state: "state",
    action: "action",
    screenshot: "screenshot",
    gui_action: "gui_action",
    gui_automation: "gui_action",
    workflow_ref: "workflow_ref",
    playwright: "playwright",
    test: "test",
    check: "check",
    check_group: "check_group",
    error_check: "check",
    log_check: "check",
    shell: "shell",
    shell_command: "shell",
    command: "shell",
    api_request: "api_request",
    api: "api_request",
    http: "api_request",
    mcp_call: "mcp_call",
    mcp: "mcp_call",
    prompt: "prompt",
    ai_prompt: "prompt",
    ai_session: "ai_session",
    ai_analysis: "ai_session",
    agentic: "ai_session",
    awas_discover: "awas",
    awas_execute: "awas",
    awas_check_support: "awas",
    awas_list_actions: "awas",
    awas_extract_elements: "awas",
    macro: "macro",
    script: "script",
  };
  return typeMap[apiType.toLowerCase()] || "unknown";
}

function mapPhase(
  apiPhase: string | undefined,
  fallback: WorkflowPhase = "setup"
): WorkflowPhase {
  if (!apiPhase) return fallback;
  const phaseMap: Record<string, WorkflowPhase> = {
    setup: "setup",
    setup_steps: "setup",
    agentic: "agentic",
    agentic_steps: "agentic",
    verification: "verification",
    verification_steps: "verification",
    completion: "completion",
    completion_steps: "completion",
  };
  return phaseMap[apiPhase.toLowerCase()] || fallback;
}

const STEP_ICONS: Record<StepType, typeof Terminal> = {
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

const STEP_COLORS: Record<
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

function formatDuration(ms: number | undefined): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

// =============================================================================
// Data transformation
// =============================================================================

function transformSteps(
  executions: CurrentExecutionStep[],
  currentStage?: string
): TimelineStep[] {
  const fallbackPhase = mapPhase(currentStage, "setup");
  return executions.map((exec, index) => {
    let status: StepStatus = exec.status as StepStatus;
    const isTerminal =
      status === "success" || status === "failed" || status === "skipped";
    if (!isTerminal && exec.start_time && !exec.end_time && !exec.duration_ms) {
      status = "running";
    }
    return {
      id: exec.id,
      type: mapStepType(exec.step_type),
      name: exec.step_name || `Step ${index + 1}`,
      status,
      phase: mapPhase(exec.phase, fallbackPhase),
      stepIndex: exec.step_index ?? index,
      iteration: exec.iteration,
      startTime: exec.start_time,
      endTime: exec.end_time,
      durationMs: exec.duration_ms,
      error: exec.error,
    };
  });
}

function sortSteps(steps: TimelineStep[]): TimelineStep[] {
  return [...steps].sort((a, b) => {
    if (a.startTime !== undefined && b.startTime !== undefined) {
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
    }
    if (a.startTime !== undefined && b.startTime === undefined) return -1;
    if (a.startTime === undefined && b.startTime !== undefined) return 1;
    if (a.stepIndex !== b.stepIndex) return a.stepIndex - b.stepIndex;
    return a.id.localeCompare(b.id);
  });
}

function buildPhaseGroups(
  allSteps: TimelineStep[],
  currentPhase: WorkflowPhase | null
): PhaseGroup[] {
  const groups = new Map<WorkflowPhase, TimelineStep[]>();
  for (const step of allSteps) {
    const existing = groups.get(step.phase) || [];
    existing.push(step);
    groups.set(step.phase, existing);
  }

  const phaseEarliestTime = new Map<WorkflowPhase, number>();
  for (const [phase, steps] of groups) {
    const times = steps
      .filter((s) => s.startTime !== undefined)
      .map((s) => s.startTime!);
    if (times.length > 0) phaseEarliestTime.set(phase, Math.min(...times));
  }

  const phasesWithSteps = Array.from(groups.keys()).filter(
    (p) => (groups.get(p)?.length ?? 0) > 0
  );
  phasesWithSteps.sort((a, b) => {
    const timeA = phaseEarliestTime.get(a);
    const timeB = phaseEarliestTime.get(b);
    if (timeA !== undefined && timeB !== undefined) return timeA - timeB;
    if (timeA !== undefined) return -1;
    if (timeB !== undefined) return 1;
    return PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b);
  });

  return phasesWithSteps.map((phase) => {
    const steps = groups.get(phase) || [];
    const completed = steps.filter(
      (s) => s.status === "success" || s.status === "failed"
    ).length;
    const successful = steps.filter((s) => s.status === "success").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const isActive = phase === currentPhase;
    const isComplete = steps.length > 0 && completed === steps.length;
    const hasIterations = phase === "verification" || phase === "agentic";
    const iterationGroups = hasIterations
      ? buildIterationGroups(steps, isActive, phase)
      : [];

    return {
      phase,
      steps: sortSteps(steps),
      iterationGroups,
      hasIterations,
      isActive,
      isComplete,
      stats: { total: steps.length, completed, successful, failed },
    };
  });
}

function buildIterationGroups(
  steps: TimelineStep[],
  activePhase: boolean,
  _phase: WorkflowPhase
): IterationGroup[] {
  const iterationMap = new Map<number, TimelineStep[]>();
  for (const step of steps) {
    const iter = step.iteration ?? 1;
    const existing = iterationMap.get(iter) || [];
    existing.push(step);
    iterationMap.set(iter, existing);
  }

  const iterations = Array.from(iterationMap.keys()).sort((a, b) => a - b);
  const maxIteration = Math.max(...iterations, 0);

  let activeIteration: number | null = null;
  if (activePhase) {
    for (let i = iterations.length - 1; i >= 0; i--) {
      const iter = iterations[i]!;
      if ((iterationMap.get(iter) || []).some((s) => s.status === "running")) {
        activeIteration = iter;
        break;
      }
    }
    if (activeIteration === null) activeIteration = maxIteration;
  }

  return iterations.map((iteration) => {
    const iterSteps = sortSteps(iterationMap.get(iteration) || []);
    const completed = iterSteps.filter(
      (s) => s.status === "success" || s.status === "failed"
    ).length;
    const successful = iterSteps.filter((s) => s.status === "success").length;
    const failed = iterSteps.filter((s) => s.status === "failed").length;
    return {
      iteration,
      steps: iterSteps,
      isActive: iteration === activeIteration,
      isComplete: iterSteps.length > 0 && completed === iterSteps.length,
      stats: { total: iterSteps.length, completed, successful, failed },
    };
  });
}

function calculateStats(
  phaseGroups: PhaseGroup[],
  elapsedTime: number
): TimelineStats {
  const verificationGroup = phaseGroups.find((g) => g.phase === "verification");
  const agenticGroup = phaseGroups.find((g) => g.phase === "agentic");
  const verificationIterations = verificationGroup?.iterationGroups || [];
  const agenticIterations = agenticGroup?.iterationGroups || [];

  const maxVerIter =
    verificationIterations.length > 0
      ? Math.max(...verificationIterations.map((g) => g.iteration))
      : 0;
  const maxAgIter =
    agenticIterations.length > 0
      ? Math.max(...agenticIterations.map((g) => g.iteration))
      : 0;
  const maxIteration = Math.max(maxVerIter, maxAgIter);

  let currentIteration: number | null = null;
  if (verificationGroup?.isActive || agenticGroup?.isActive) {
    const activeVer = verificationIterations.find((g) => g.isActive);
    const activeAg = agenticIterations.find((g) => g.isActive);
    currentIteration =
      activeVer?.iteration || activeAg?.iteration || maxIteration || null;
  } else if (maxIteration > 0) {
    currentIteration = maxIteration;
  }

  const verificationResults = verificationIterations.map((iterGroup) => {
    const checkSteps = iterGroup.steps.filter(
      (s) =>
        s.type === "check" ||
        s.type === "test" ||
        s.type === "playwright" ||
        s.type === "check_group"
    );
    const passed = checkSteps.filter((s) => s.status === "success").length;
    const total = checkSteps.length;
    const allComplete = checkSteps.every(
      (s) => s.status === "success" || s.status === "failed"
    );
    return {
      iteration: iterGroup.iteration,
      passed,
      total,
      isComplete: allComplete,
    };
  });

  let improvement: TimelineStats["improvement"] = null;
  const completedResults = verificationResults.filter((r) => r.isComplete);
  if (completedResults.length >= 2) {
    const current = completedResults[completedResults.length - 1]!;
    const previous = completedResults[completedResults.length - 2]!;
    if (current.total > 0 && previous.total > 0) {
      const delta = current.passed - previous.passed;
      improvement = {
        delta,
        total: current.total,
        percentage: (delta / current.total) * 100,
      };
    }
  }

  const completedIterationDurations: number[] = [];
  for (let i = 1; i <= maxIteration; i++) {
    const verIter = verificationIterations.find((g) => g.iteration === i);
    const agIter = agenticIterations.find((g) => g.iteration === i);
    if (verIter?.isComplete && agIter?.isComplete) {
      const allStepsInIter = [...verIter.steps, ...agIter.steps];
      const starts = allStepsInIter
        .filter((s) => s.startTime)
        .map((s) => s.startTime!);
      const ends = allStepsInIter
        .filter((s) => s.endTime)
        .map((s) => s.endTime!);
      if (starts.length > 0 && ends.length > 0) {
        completedIterationDurations.push(
          Math.max(...ends) - Math.min(...starts)
        );
      }
    }
  }
  const avgIterationDurationMs =
    completedIterationDurations.length > 0
      ? completedIterationDurations.reduce((a, b) => a + b, 0) /
        completedIterationDurations.length
      : null;

  return {
    elapsedTime,
    currentIteration,
    maxIteration,
    avgIterationDurationMs,
    verificationResults,
    improvement,
  };
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="size-3.5 text-red-500 shrink-0" />;
    case "running":
      return (
        <Loader2 className="size-3.5 text-blue-400 animate-spin shrink-0" />
      );
    case "skipped":
      return <div className="size-3.5 rounded-full bg-zinc-600 shrink-0" />;
    default:
      return (
        <div className="size-3.5 rounded-full bg-border-subtle shrink-0" />
      );
  }
}

function StepRow({ step }: { step: TimelineStep }) {
  const Icon = STEP_ICONS[step.type];
  const colors = STEP_COLORS[step.type];
  const isActive = step.status === "running";

  return (
    <div
      className={cn(
        "border-l-2 transition-colors",
        isActive
          ? "border-blue-500 bg-blue-500/5"
          : "border-transparent hover:bg-white/[0.02]"
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <StatusIcon status={step.status} />
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] shrink-0 font-mono gap-1 px-1.5 py-0 h-5",
            colors.bg,
            colors.text,
            colors.border
          )}
        >
          <Icon className="size-2.5" />
          {step.type}
        </Badge>
        <span className="flex-1 text-xs truncate text-text-primary">
          {step.name}
        </span>
        {step.durationMs !== undefined && (
          <span className="text-[10px] text-text-muted font-mono shrink-0">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {isActive && (
          <Loader2 className="size-3 text-blue-400 animate-spin shrink-0" />
        )}
        {step.error && (
          <span title={step.error}>
            <AlertCircle className="size-3 text-red-500 shrink-0" />
          </span>
        )}
      </div>
    </div>
  );
}

function IterationSection({
  iterationGroup,
  phase,
  defaultExpanded = true,
}: {
  iterationGroup: IterationGroup;
  phase: WorkflowPhase;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = PHASE_CONFIG[phase];
  const hasRunningStep = iterationGroup.steps.some(
    (s) => s.status === "running"
  );

  return (
    <div className="border-l border-border-subtle/30 ml-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-white/[0.02]",
          iterationGroup.isActive &&
            cn(config.bgColor, "border-l-2", config.borderColor)
        )}
      >
        {expanded ? (
          <ChevronDown className="size-3 text-text-muted" />
        ) : (
          <ChevronRight className="size-3 text-text-muted" />
        )}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 gap-1",
            iterationGroup.isActive
              ? cn(config.textColor, config.borderColor)
              : "text-text-muted border-border-subtle/50"
          )}
        >
          <RotateCcw className="size-2.5" />
          Iteration {iterationGroup.iteration}
        </Badge>
        {hasRunningStep && (
          <Loader2 className={cn("size-3 animate-spin", config.textColor)} />
        )}
        <span className="text-[10px] text-text-muted ml-auto">
          {iterationGroup.stats.completed}/{iterationGroup.stats.total}
        </span>
        {iterationGroup.stats.successful > 0 && (
          <span className="text-[10px] text-green-400">
            {iterationGroup.stats.successful}{" "}
            {phase === "agentic" ? "done" : "passed"}
          </span>
        )}
        {iterationGroup.stats.failed > 0 && (
          <span className="text-[10px] text-red-400">
            {iterationGroup.stats.failed} failed
          </span>
        )}
      </button>
      {expanded && (
        <div className="bg-white/[0.01]">
          {iterationGroup.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhaseSection({
  group,
  defaultExpanded = true,
  expandedIterations,
}: {
  group: PhaseGroup;
  defaultExpanded?: boolean;
  expandedIterations: Set<string>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || group.isActive);
  const config = PHASE_CONFIG[group.phase];
  const showFlatList =
    !group.hasIterations || group.iterationGroups.length === 0;
  const hasRunningStep = group.steps.some((s) => s.status === "running");

  return (
    <div className="border-b border-border-subtle/30 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03]",
          group.isActive && cn(config.bgColor, config.borderColor, "border-l-2")
        )}
      >
        {expanded ? (
          <ChevronDown className="size-4 text-text-muted" />
        ) : (
          <ChevronRight className="size-4 text-text-muted" />
        )}
        <Badge
          variant="outline"
          className={cn(
            "px-2 py-0.5 text-xs font-medium",
            group.isActive
              ? cn(config.bgColor, config.textColor, config.borderColor)
              : group.isComplete
                ? "bg-green-500/10 text-green-400 border-green-500/30"
                : "bg-white/5 text-text-muted border-border-subtle/50"
          )}
        >
          {config.label}
        </Badge>
        {hasRunningStep && (
          <Loader2 className={cn("size-3.5 animate-spin", config.textColor)} />
        )}
        {group.hasIterations && group.iterationGroups.length > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-5 gap-1 text-text-muted border-border-subtle/50"
          >
            <RotateCcw className="size-2.5" />
            {group.iterationGroups.length} iter
          </Badge>
        )}
        {!group.hasIterations && (
          <span className="text-xs text-text-muted ml-auto">
            {group.stats.completed}/{group.stats.total} steps
          </span>
        )}
        {!group.hasIterations && group.stats.successful > 0 && (
          <span className="text-[10px] text-green-400">
            {group.stats.successful}{" "}
            {group.phase === "agentic" ? "done" : "passed"}
          </span>
        )}
        {!group.hasIterations && group.stats.failed > 0 && (
          <span className="text-[10px] text-red-400">
            {group.stats.failed} failed
          </span>
        )}
      </button>
      {expanded && (
        <div className="bg-white/[0.01]">
          {showFlatList ? (
            <>
              {group.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
              {group.steps.length === 0 && (
                <div className="px-4 py-3 text-xs text-text-muted text-center">
                  No steps in this phase yet
                </div>
              )}
            </>
          ) : (
            <>
              {group.iterationGroups.map((iterGroup) => {
                const iterKey = `${group.phase}-${iterGroup.iteration}`;
                return (
                  <IterationSection
                    key={iterKey}
                    iterationGroup={iterGroup}
                    phase={group.phase}
                    defaultExpanded={expandedIterations.has(iterKey)}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineStatsBar({
  stats,
  totalSteps,
  completedSteps,
  failedSteps,
}: {
  stats: TimelineStats;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
}) {
  let ImprovementIcon = Minus;
  let improvementColor = "text-text-muted";
  if (stats.improvement) {
    if (stats.improvement.delta > 0) {
      ImprovementIcon = TrendingUp;
      improvementColor = "text-green-400";
    } else if (stats.improvement.delta < 0) {
      ImprovementIcon = TrendingDown;
      improvementColor = "text-red-400";
    }
  }

  const progressPercent =
    totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  const progressColor =
    failedSteps > 0
      ? "bg-red-500"
      : completedSteps === totalSteps && totalSteps > 0
        ? "bg-green-500"
        : "bg-blue-500";

  return (
    <div className="border-b border-border-subtle/30 px-4 py-2.5 bg-white/[0.02]">
      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
            <span>
              {completedSteps}/{totalSteps} steps
            </span>
            {failedSteps > 0 && (
              <span className="text-red-400">{failedSteps} failed</span>
            )}
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                progressColor
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-text-muted" />
          <div>
            <p className="text-[10px] text-text-muted leading-none">Elapsed</p>
            <p className="font-mono text-xs text-text-primary">
              {formatTime(stats.elapsedTime)}
            </p>
          </div>
        </div>
        {stats.maxIteration > 0 && (
          <div className="flex items-center gap-1.5">
            <RotateCcw className="size-3.5 text-text-muted" />
            <div>
              <p className="text-[10px] text-text-muted leading-none">
                Iteration
              </p>
              <p className="font-mono text-xs text-text-primary">
                {stats.currentIteration ?? stats.maxIteration}
              </p>
            </div>
          </div>
        )}
        {stats.avgIterationDurationMs !== null && (
          <div className="flex items-center gap-1.5">
            <Timer className="size-3.5 text-text-muted" />
            <div>
              <p className="text-[10px] text-text-muted leading-none">
                Avg Iteration
              </p>
              <p className="font-mono text-xs text-text-primary">
                {formatDuration(stats.avgIterationDurationMs)}
              </p>
            </div>
          </div>
        )}
        {stats.improvement && (
          <div className="flex items-center gap-1.5">
            <ImprovementIcon className={cn("size-3.5", improvementColor)} />
            <div>
              <p className="text-[10px] text-text-muted leading-none">
                vs Last
              </p>
              <p className={cn("font-mono text-xs", improvementColor)}>
                {stats.improvement.delta > 0 ? "+" : ""}
                {stats.improvement.delta}/{stats.improvement.total}
                <span className="text-[10px] ml-1">
                  ({stats.improvement.percentage > 0 ? "+" : ""}
                  {stats.improvement.percentage.toFixed(0)}%)
                </span>
              </p>
            </div>
          </div>
        )}
        {!stats.improvement &&
          stats.verificationResults.length > 0 &&
          (() => {
            const lastResult =
              stats.verificationResults[stats.verificationResults.length - 1]!;
            return (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="size-3.5 text-text-muted" />
                <div>
                  <p className="text-[10px] text-text-muted leading-none">
                    Verification
                  </p>
                  <p className="font-mono text-xs text-text-primary">
                    {lastResult.passed}/{lastResult.total} passed
                  </p>
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}

// =============================================================================
// Main Widget
// =============================================================================

export function ExecutionTimelineWidget({ runId: _runId }: { runId: string }) {
  const { data: response, isLoading } = useSharedStepsData();

  // Elapsed time tracking
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Iteration expansion tracking
  const [expandedIterations, setExpandedIterations] = useState<Set<string>>(
    new Set()
  );
  const prevIterationCounts = useRef<Map<string, number>>(new Map());

  // Transform API data into timeline steps
  const allSteps = useMemo(() => {
    if (!response?.executions) return [];
    return transformSteps(response.executions, response.current_stage);
  }, [response]);

  // Set start time from workflow_start_time or earliest step
  useEffect(() => {
    if (startTime) return;
    if (response?.workflow_start_time) {
      const ms = new Date(response.workflow_start_time).getTime();
      if (!isNaN(ms)) {
        setStartTime(ms);
        return;
      }
    }
    if (allSteps.length > 0) {
      const earliest = Math.min(
        ...allSteps.filter((s) => s.startTime).map((s) => s.startTime!)
      );
      if (earliest && earliest !== Infinity) setStartTime(earliest);
    }
  }, [response, allSteps, startTime]);

  // Update elapsed time
  useEffect(() => {
    if (!startTime) {
      setElapsedTime(0);
      return;
    }
    const update = () =>
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Detect current phase
  const currentPhase = useMemo((): WorkflowPhase | null => {
    if (response?.current_stage) return mapPhase(response.current_stage);
    const running = allSteps.find((s) => s.status === "running");
    if (running) return running.phase;
    for (const phase of PHASE_ORDER) {
      if (
        allSteps.some(
          (s) =>
            s.phase === phase &&
            (s.status === "pending" || s.status === "running")
        )
      )
        return phase;
    }
    return null;
  }, [allSteps, response]);

  // Build phase groups
  const phaseGroups = useMemo(
    () => buildPhaseGroups(allSteps, currentPhase),
    [allSteps, currentPhase]
  );

  // Calculate stats
  const stats = useMemo(
    () => calculateStats(phaseGroups, elapsedTime),
    [phaseGroups, elapsedTime]
  );

  // Step stats
  const stepStats = useMemo(() => {
    const total = allSteps.length;
    const completed = allSteps.filter(
      (s) => s.status === "success" || s.status === "failed"
    ).length;
    const successful = allSteps.filter((s) => s.status === "success").length;
    const failed = allSteps.filter((s) => s.status === "failed").length;
    return { total, completed, successful, failed };
  }, [allSteps]);

  // Auto-expand latest iteration
  useEffect(() => {
    setExpandedIterations((prevExpanded) => {
      const newSet = new Set<string>();
      for (const group of phaseGroups) {
        if (!group.hasIterations || group.iterationGroups.length === 0)
          continue;
        const prevCount = prevIterationCounts.current.get(group.phase) ?? 0;
        const currentCount = group.iterationGroups.length;
        const maxIter = Math.max(
          ...group.iterationGroups.map((g) => g.iteration)
        );
        if (currentCount > prevCount) {
          newSet.add(`${group.phase}-${maxIter}`);
        } else {
          for (const iterGroup of group.iterationGroups) {
            const key = `${group.phase}-${iterGroup.iteration}`;
            if (prevExpanded.has(key)) newSet.add(key);
          }
          const phaseHasExpanded = group.iterationGroups.some((g) =>
            newSet.has(`${group.phase}-${g.iteration}`)
          );
          if (!phaseHasExpanded) newSet.add(`${group.phase}-${maxIter}`);
        }
        prevIterationCounts.current.set(group.phase, currentCount);
      }
      return newSet;
    });
  }, [phaseGroups]);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="size-4 text-blue-400" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col overflow-hidden">
      <CardHeader className="py-2.5 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="size-4 text-blue-400" />
          Timeline
          {response?.workflow_name && (
            <span className="text-xs font-normal text-text-muted truncate">
              {response.workflow_name}
            </span>
          )}
          {currentPhase && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] ml-auto",
                PHASE_CONFIG[currentPhase].textColor,
                PHASE_CONFIG[currentPhase].borderColor
              )}
            >
              {PHASE_CONFIG[currentPhase].label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      {/* Stats Bar */}
      <TimelineStatsBar
        stats={stats}
        totalSteps={stepStats.total}
        completedSteps={stepStats.completed}
        failedSteps={stepStats.failed}
      />

      {/* Phase Groups */}
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          <div className="flex flex-col">
            {phaseGroups.map((group) => (
              <PhaseSection
                key={group.phase}
                group={group}
                defaultExpanded={group.isActive || group.steps.length < 10}
                expandedIterations={expandedIterations}
              />
            ))}
            {phaseGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-text-muted">
                <Clock className="size-8 mb-2 opacity-50" />
                <span className="text-sm">Waiting for steps to execute...</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
