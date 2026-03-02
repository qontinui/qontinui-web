import type { Checkpoint } from "@/lib/runner-api";
import { Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  PHASE_LABELS,
  PHASE_ORDER,
  STEP_TYPE_ICONS,
  type ParsedStepData,
  type StageData,
  type WorkflowPhase,
} from "../_types/timeline-types";

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60)
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function getStepTypeIcon(
  stepType: string,
  iconType?: string
): {
  icon: LucideIcon;
  bg: string;
  text: string;
} {
  if (iconType && STEP_TYPE_ICONS[iconType]) {
    return STEP_TYPE_ICONS[iconType];
  }
  return (
    STEP_TYPE_ICONS[stepType] || {
      icon: Activity,
      bg: "bg-zinc-500/10",
      text: "text-zinc-400",
    }
  );
}

export function parseStepData(step: Checkpoint): ParsedStepData {
  const result: ParsedStepData = {};
  if (!step.result_json) return result;

  try {
    const parsed = JSON.parse(step.result_json);
    result.iconType = parsed.icon_type || undefined;
    result.workSummary = parsed.work_summary || undefined;
    result.summary = parsed.summary || parsed.message || undefined;
    if (parsed.error) result.error = parsed.error;
    if (parsed.progress && typeof parsed.progress === "object") {
      result.progress = {
        current: parsed.progress.current ?? 0,
        total: parsed.progress.total ?? null,
        type: parsed.progress.type || "default",
        description: parsed.progress.description || undefined,
      };
    }
  } catch {
    // ignore parse errors
  }

  return result;
}

export function buildStagesFromCheckpoints(
  checkpoints: Checkpoint[]
): StageData[] {
  const groups = new Map<string, Checkpoint[]>();

  for (const cp of checkpoints) {
    const phase = cp.phase || "agentic";
    const iter = cp.iteration ?? 0;
    const key = `${phase}-${iter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cp);
  }

  const stages: StageData[] = [];

  for (const [key, steps] of groups) {
    const [phase, iterStr] = key.split("-");
    const iteration = parseInt(iterStr!, 10);
    const validPhase = (phase as WorkflowPhase) || "agentic";

    steps.sort((a, b) => a.step_index - b.step_index);

    let status = "pending";
    if (steps.some((s) => s.status === "running")) {
      status = "running";
    } else if (steps.some((s) => s.status === "failed")) {
      status = "failed";
    } else if (steps.every((s) => s.status === "success")) {
      status = "success";
    } else if (steps.some((s) => s.status === "success")) {
      status = "success";
    }

    const timestamps = steps
      .filter((s) => s.started_at)
      .map((s) => new Date(s.started_at!).getTime());
    const endTimestamps = steps
      .filter((s) => s.completed_at)
      .map((s) => new Date(s.completed_at!).getTime());

    const startedAt =
      timestamps.length > 0
        ? (steps.find(
            (s) =>
              s.started_at &&
              new Date(s.started_at).getTime() === Math.min(...timestamps)
          )?.started_at ?? null)
        : null;

    const endedAt =
      endTimestamps.length > 0
        ? (steps.find(
            (s) =>
              s.completed_at &&
              new Date(s.completed_at).getTime() === Math.max(...endTimestamps)
          )?.completed_at ?? null)
        : null;

    const totalDurationMs = steps.reduce(
      (sum, s) => sum + (s.duration_ms || 0),
      0
    );

    const showIteration =
      (validPhase === "verification" || validPhase === "agentic") &&
      iteration > 0
        ? iteration
        : null;

    stages.push({
      phase: validPhase,
      displayName: PHASE_LABELS[validPhase] || validPhase,
      status,
      startedAt,
      endedAt,
      durationMs: totalDurationMs > 0 ? totalDurationMs : null,
      steps,
      iteration: showIteration,
    });
  }

  stages.sort((a, b) => {
    const aPhase = PHASE_ORDER[a.phase] ?? 2;
    const bPhase = PHASE_ORDER[b.phase] ?? 2;
    const aIter = a.iteration ?? 0;
    const bIter = b.iteration ?? 0;

    if (aPhase === 0 || bPhase === 0 || aPhase === 3 || bPhase === 3) {
      return aPhase - bPhase;
    }

    if (aIter !== bIter) return aIter - bIter;

    if (aPhase !== bPhase) return aPhase - bPhase;

    if (a.startedAt && b.startedAt) {
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    }
    return 0;
  });

  return stages;
}
