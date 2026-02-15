"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTaskRunList } from "@/hooks/useTaskRunData";
import type { TaskRunView } from "@/lib/task-run-mappers";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      return <Clock className="size-4 text-text-muted" />;
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
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="size-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">
              Run Summaries
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-border-default"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <p className="text-text-muted">
          AI-generated summaries and recaps for completed task runs.
        </p>

        {isRunnerOffline && <RunnerPartialState />}

        {isLoading ? (
          <div className="text-center py-16 text-text-muted">
            <Loader2 className="size-6 animate-spin mx-auto mb-3" />
            Loading run summaries...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading data: {error?.message ?? "Unknown error"}
          </div>
        ) : !stats ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-16">
              <div className="text-center text-text-muted">
                <FileText className="size-16 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-secondary mb-2">
                  No Runs Yet
                </h3>
                <p className="text-sm">
                  Run summaries will appear here after task runs complete in the
                  Runner.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-surface-raised/30 border-border-subtle/50">
                <CardContent className="pt-6">
                  <div
                    className="text-xs text-text-muted mb-2"
                    data-content-role="label"
                  >
                    Total Runs
                  </div>
                  <div
                    className="text-3xl font-bold text-text-primary"
                    data-content-role="metric"
                    data-content-label="summary-total-runs"
                  >
                    {stats.total}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-surface-raised/30 border-border-subtle/50">
                <CardContent className="pt-6">
                  <div
                    className="text-xs text-text-muted mb-2"
                    data-content-role="label"
                  >
                    Completed
                  </div>
                  <div
                    className="text-3xl font-bold text-green-500"
                    data-content-role="metric"
                    data-content-label="summary-completed"
                  >
                    {stats.completed}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-surface-raised/30 border-border-subtle/50">
                <CardContent className="pt-6">
                  <div
                    className="text-xs text-text-muted mb-2"
                    data-content-role="label"
                  >
                    Failed
                  </div>
                  <div
                    className="text-3xl font-bold text-red-500"
                    data-content-role="metric"
                    data-content-label="summary-failed"
                  >
                    {stats.failed}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-surface-raised/30 border-border-subtle/50">
                <CardContent className="pt-6">
                  <div
                    className="text-xs text-text-muted mb-2"
                    data-content-role="label"
                  >
                    With AI Summary
                  </div>
                  <div
                    className="text-3xl font-bold text-text-primary"
                    data-content-role="metric"
                    data-content-label="summary-with-ai"
                  >
                    {stats.withSummary}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Runs with Summaries */}
            <Card className="bg-surface-raised/30 border-border-subtle/50">
              <CardContent className="pt-6">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border-subtle/50">
                        <TableHead>Status</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(runs || []).map((run: TaskRunView) => (
                        <TableRow
                          key={run.id}
                          className="border-border-subtle/50 hover:bg-surface-raised/30 cursor-pointer"
                          onClick={() => router.push(`/runs/${run.id}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getStatusIcon(run.status)}
                              {getStatusBadge(run.status)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-text-primary">
                              {run.task_name}
                            </div>
                            {run.workflow_name && (
                              <div className="text-xs text-text-muted mt-0.5">
                                {run.workflow_name}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <p className="text-xs text-text-secondary truncate">
                              {run.summary ||
                                (run.status === "running"
                                  ? "In progress..."
                                  : "No summary available")}
                            </p>
                          </TableCell>
                          <TableCell className="text-right text-sm text-text-secondary">
                            {formatDuration(run.duration_seconds)}
                          </TableCell>
                          <TableCell className="text-sm text-text-muted">
                            {formatDateTime(run.created_at)}
                          </TableCell>
                          <TableCell>
                            <ArrowRight className="size-4 text-text-muted" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
