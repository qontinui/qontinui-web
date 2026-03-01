import type { CurrentExecutionStep } from "@/lib/runner-api";
import type {
  StepType,
  StepStatus,
  WorkflowPhase,
  TimelineStep,
  IterationGroup,
  PhaseGroup,
  TimelineStats,
} from "./execution-timeline-types";
import { PHASE_ORDER, PHASE_CONFIG } from "./execution-timeline-types";

// =============================================================================
// Mapping helpers
// =============================================================================

export function mapStepType(apiType: string): StepType {
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

export function mapPhase(
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

// =============================================================================
// Formatting helpers
// =============================================================================

export function formatDuration(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function formatTime(seconds: number): string {
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

export function transformSteps(
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
      stageIndex: exec.stage_index ?? 0,
      stepIndex: exec.step_index ?? index,
      iteration: exec.iteration,
      startTime: exec.start_time,
      endTime: exec.end_time,
      durationMs: exec.duration_ms,
      error: exec.error,
    };
  });
}

export function sortSteps(steps: TimelineStep[]): TimelineStep[] {
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

export function buildPhaseGroups(
  allSteps: TimelineStep[],
  currentPhase: WorkflowPhase | null,
  totalStages?: number,
  currentStageIndex?: number
): PhaseGroup[] {
  // Group by composite key (stageIndex:phase) to handle multi-stage workflows.
  // For single-stage (all stageIndex=0), this behaves identically to the old phase-only grouping.
  const groupKey = (step: TimelineStep) => `${step.stageIndex}:${step.phase}`;
  const groups = new Map<string, TimelineStep[]>();
  for (const step of allSteps) {
    const key = groupKey(step);
    const existing = groups.get(key) || [];
    existing.push(step);
    groups.set(key, existing);
  }

  const groupEarliestTime = new Map<string, number>();
  for (const [key, steps] of groups) {
    const times = steps
      .filter((s) => s.startTime !== undefined)
      .map((s) => s.startTime!);
    if (times.length > 0) groupEarliestTime.set(key, Math.min(...times));
  }

  const keysWithSteps = Array.from(groups.keys()).filter(
    (k) => (groups.get(k)?.length ?? 0) > 0
  );
  keysWithSteps.sort((a, b) => {
    const timeA = groupEarliestTime.get(a);
    const timeB = groupEarliestTime.get(b);
    if (timeA !== undefined && timeB !== undefined) return timeA - timeB;
    if (timeA !== undefined) return -1;
    if (timeB !== undefined) return 1;
    // Fallback: sort by stage index first, then phase order
    const [stageA, phaseA] = a.split(":") as [string, WorkflowPhase];
    const [stageB, phaseB] = b.split(":") as [string, WorkflowPhase];
    if (stageA !== stageB) return parseInt(stageA) - parseInt(stageB);
    return PHASE_ORDER.indexOf(phaseA) - PHASE_ORDER.indexOf(phaseB);
  });

  const isMultiStage = (totalStages ?? 0) > 1;

  return keysWithSteps.map((key) => {
    const steps = groups.get(key) || [];
    const [stageIdxStr, phaseStr] = key.split(":") as [string, WorkflowPhase];
    const stageIdx = parseInt(stageIdxStr);
    const phase = phaseStr;
    const completed = steps.filter(
      (s) => s.status === "success" || s.status === "failed"
    ).length;
    const successful = steps.filter((s) => s.status === "success").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const isActive =
      phase === currentPhase &&
      (!isMultiStage || stageIdx === (currentStageIndex ?? 0));
    const isComplete = steps.length > 0 && completed === steps.length;
    const hasIterations = phase === "verification" || phase === "agentic";
    const iterationGroups = hasIterations
      ? buildIterationGroups(steps, isActive, phase)
      : [];

    const config = PHASE_CONFIG[phase];
    const displayLabel = isMultiStage
      ? `Stage ${stageIdx + 1} — ${config?.label ?? phase}`
      : (config?.label ?? phase);

    return {
      phase,
      stageIndex: stageIdx,
      displayLabel,
      steps: sortSteps(steps),
      iterationGroups,
      hasIterations,
      isActive,
      isComplete,
      stats: { total: steps.length, completed, successful, failed },
    };
  });
}

export function buildIterationGroups(
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

export function calculateStats(
  phaseGroups: PhaseGroup[],
  elapsedTime: number
): TimelineStats {
  const verificationGroup =
    phaseGroups.find((g) => g.phase === "verification" && g.isActive) ??
    phaseGroups.findLast((g) => g.phase === "verification");
  const agenticGroup =
    phaseGroups.find((g) => g.phase === "agentic" && g.isActive) ??
    phaseGroups.findLast((g) => g.phase === "agentic");
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
