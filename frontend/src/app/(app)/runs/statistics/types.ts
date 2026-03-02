import type { TaskRunView } from "@/lib/task-run-mappers";

export interface Stats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  stoppedRuns: number;
  avgDuration: number;
  successRate: number;
  totalDuration: number;
  longestRun: TaskRunView | null;
  shortestRun: TaskRunView | null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function computeStats(runs: TaskRunView[]): Stats {
  const completedRuns = runs.filter((r) => r.status === "completed");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const runningRuns = runs.filter((r) => r.status === "running");
  const stoppedRuns = runs.filter((r) => r.status === "stopped");

  const finishedRuns = runs.filter(
    (r) => r.duration_seconds != null && r.duration_seconds > 0
  );
  const totalDuration = finishedRuns.reduce(
    (sum, r) => sum + (r.duration_seconds || 0),
    0
  );
  const avgDuration =
    finishedRuns.length > 0 ? totalDuration / finishedRuns.length : 0;

  const finishedCount = completedRuns.length + failedRuns.length;
  const successRate =
    finishedCount > 0 ? (completedRuns.length / finishedCount) * 100 : 0;

  let longestRun: TaskRunView | null = null;
  let shortestRun: TaskRunView | null = null;
  for (const r of finishedRuns) {
    if (
      !longestRun ||
      (r.duration_seconds || 0) > (longestRun.duration_seconds || 0)
    ) {
      longestRun = r;
    }
    if (
      !shortestRun ||
      (r.duration_seconds || 0) < (shortestRun.duration_seconds || 0)
    ) {
      shortestRun = r;
    }
  }

  return {
    totalRuns: runs.length,
    completedRuns: completedRuns.length,
    failedRuns: failedRuns.length,
    runningRuns: runningRuns.length,
    stoppedRuns: stoppedRuns.length,
    avgDuration,
    successRate,
    totalDuration,
    longestRun,
    shortestRun,
  };
}
