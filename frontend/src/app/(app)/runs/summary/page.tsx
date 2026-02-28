"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTaskRunList } from "@/hooks/useTaskRunData";
import type { TaskRunView } from "@/lib/task-run-mappers";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock,
  ArrowRight,
  Loader2,
} from "lucide-react";

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return <Badge variant="info">Running</Badge>;
    case "stopped":
      return <Badge variant="secondary">Stopped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <PlayCircle className="size-4 text-blue-500 animate-pulse" />;
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatDateTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

export default function SummaryPage() {
  const router = useRouter();
  const {
    data: runs,
    isLoading,
    error,
    isRunnerOffline,
    refetch,
  } = useTaskRunList({ limit: 50 });

  const stats = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    const completed = runs.filter((r) => r.status === "completed").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const running = runs.filter((r) => r.status === "running").length;
    const withSummary = runs.filter((r) => r.summary).length;
    return { total: runs.length, completed, failed, running, withSummary };
  }, [runs]);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Run Summaries</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          AI-generated summaries and recaps for completed task runs.
        </p>

        {isRunnerOffline && <RunnerPartialState />}

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <Loader2 className="size-6 animate-spin mx-auto mb-3" />
            Loading run summaries...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading data: {error?.message ?? "Unknown error"}
          </div>
        ) : !stats ? (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="size-16 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Runs Yet</h3>
            <p className="text-sm">
              Run summaries will appear here after task runs complete in the
              Runner.
            </p>
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-px bg-border rounded-lg overflow-hidden">
              <div className="bg-background px-4 py-3">
                <div
                  className="text-xs text-muted-foreground mb-1"
                  data-content-role="label"
                >
                  Total Runs
                </div>
                <div
                  className="text-2xl font-bold tabular-nums"
                  data-content-role="metric"
                  data-content-label="summary-total-runs"
                >
                  {stats.total}
                </div>
              </div>
              <div className="bg-background px-4 py-3">
                <div
                  className="text-xs text-muted-foreground mb-1"
                  data-content-role="label"
                >
                  Completed
                </div>
                <div
                  className="text-2xl font-bold text-green-500 tabular-nums"
                  data-content-role="metric"
                  data-content-label="summary-completed"
                >
                  {stats.completed}
                </div>
              </div>
              <div className="bg-background px-4 py-3">
                <div
                  className="text-xs text-muted-foreground mb-1"
                  data-content-role="label"
                >
                  Failed
                </div>
                <div
                  className="text-2xl font-bold text-red-500 tabular-nums"
                  data-content-role="metric"
                  data-content-label="summary-failed"
                >
                  {stats.failed}
                </div>
              </div>
              <div className="bg-background px-4 py-3">
                <div
                  className="text-xs text-muted-foreground mb-1"
                  data-content-role="label"
                >
                  With AI Summary
                </div>
                <div
                  className="text-2xl font-bold tabular-nums"
                  data-content-role="metric"
                  data-content-label="summary-with-ai"
                >
                  {stats.withSummary}
                </div>
              </div>
            </div>

            {/* Runs with Summaries */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/80 backdrop-blur-sm">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        Status
                      </th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        Name
                      </th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        Summary
                      </th>
                      <th className="text-right px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        Duration
                      </th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        Started
                      </th>
                      <th className="w-10 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(runs || []).map((run: TaskRunView) => (
                      <tr
                        key={run.id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => router.push(`/runs/${run.id}`)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(run.status)}
                            {getStatusBadge(run.status)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">
                            {run.task_name}
                          </div>
                          {run.workflow_name && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {run.workflow_name}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 max-w-[300px]">
                          <p className="text-xs text-muted-foreground truncate">
                            {run.summary ||
                              (run.status === "running"
                                ? "In progress..."
                                : "No summary available")}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm text-muted-foreground tabular-nums">
                          {formatDuration(run.duration_seconds)}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-muted-foreground tabular-nums">
                          {formatDateTime(run.created_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <ArrowRight className="size-4 text-muted-foreground" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
