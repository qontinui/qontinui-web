"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTaskRuns } from "@/lib/runner-api";
import type { TaskRun } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  BarChart3,
  RefreshCw,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Timer,
  Hash,
  PlayCircle,
  ArrowRight,
} from "lucide-react";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

interface Stats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  stoppedRuns: number;
  avgDuration: number;
  successRate: number;
  totalDuration: number;
  longestRun: TaskRun | null;
  shortestRun: TaskRun | null;
}

function computeStats(runs: TaskRun[]): Stats {
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

  let longestRun: TaskRun | null = null;
  let shortestRun: TaskRun | null = null;
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

export default function StatisticsPage() {
  const router = useRouter();
  const {
    data: runs,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useTaskRuns({ limit: 50 });

  const [viewMode, setViewMode] = useState<"overview" | "performance">(
    "overview"
  );
  const [timeRange, setTimeRange] = useState("all");

  const stats = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    return computeStats(runs);
  }, [runs]);

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="size-6 text-green-500" />
            <h1 className="text-2xl font-bold text-text-primary">Statistics</h1>
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
          Performance analytics computed from recent task runs.
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "overview" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("overview")}
            className={
              viewMode === "overview" ? "bg-brand-primary text-black" : ""
            }
          >
            Overview
          </Button>
          <Button
            variant={viewMode === "performance" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("performance")}
            className={
              viewMode === "performance" ? "bg-brand-primary text-black" : ""
            }
          >
            Performance
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-text-muted">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Computing statistics...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading data: {error}
          </div>
        ) : !stats ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-16">
              <div className="text-center text-text-muted">
                <BarChart3 className="size-16 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-secondary mb-2">
                  No Data Available
                </h3>
                <p className="text-sm">
                  Run some tasks in the Runner to see performance statistics.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {viewMode === "overview" && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 mb-2">
                        <Hash className="size-4 text-text-muted" />
                        <span
                          className="text-xs text-text-muted"
                          data-content-role="label"
                        >
                          Total Runs
                        </span>
                      </div>
                      <div
                        className="text-3xl font-bold text-text-primary"
                        data-content-role="metric"
                        data-content-label="total-runs"
                      >
                        {stats.totalRuns}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 mb-2">
                        <Timer className="size-4 text-text-muted" />
                        <span
                          className="text-xs text-text-muted"
                          data-content-role="label"
                        >
                          Avg Duration
                        </span>
                      </div>
                      <div
                        className="text-3xl font-bold text-text-primary"
                        data-content-role="metric"
                        data-content-label="avg-duration"
                      >
                        {formatDuration(stats.avgDuration)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="size-4 text-text-muted" />
                        <span
                          className="text-xs text-text-muted"
                          data-content-role="label"
                        >
                          Success Rate
                        </span>
                      </div>
                      <div
                        className={`text-3xl font-bold ${
                          stats.successRate >= 80
                            ? "text-green-500"
                            : stats.successRate >= 50
                              ? "text-yellow-500"
                              : "text-red-500"
                        }`}
                        data-content-role="metric"
                        data-content-label="success-rate"
                      >
                        {stats.successRate.toFixed(0)}%
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="size-4 text-text-muted" />
                        <span
                          className="text-xs text-text-muted"
                          data-content-role="label"
                        >
                          Total Time
                        </span>
                      </div>
                      <div
                        className="text-3xl font-bold text-text-primary"
                        data-content-role="metric"
                        data-content-label="total-time"
                      >
                        {formatDuration(stats.totalDuration)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Status Breakdown */}
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="size-4" />
                      Status Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-canvas/50">
                        <CheckCircle2 className="size-5 text-green-500" />
                        <div>
                          <div
                            className="text-xl font-bold text-green-500"
                            data-content-role="metric"
                            data-content-label="completed-runs"
                          >
                            {stats.completedRuns}
                          </div>
                          <div
                            className="text-xs text-text-muted"
                            data-content-role="label"
                          >
                            Completed
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-canvas/50">
                        <XCircle className="size-5 text-red-500" />
                        <div>
                          <div
                            className="text-xl font-bold text-red-500"
                            data-content-role="metric"
                            data-content-label="failed-runs"
                          >
                            {stats.failedRuns}
                          </div>
                          <div
                            className="text-xs text-text-muted"
                            data-content-role="label"
                          >
                            Failed
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-canvas/50">
                        <PlayCircle className="size-5 text-blue-500" />
                        <div>
                          <div
                            className="text-xl font-bold text-blue-500"
                            data-content-role="metric"
                            data-content-label="running-runs"
                          >
                            {stats.runningRuns}
                          </div>
                          <div
                            className="text-xs text-text-muted"
                            data-content-role="label"
                          >
                            Running
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-canvas/50">
                        <Clock className="size-5 text-text-muted" />
                        <div>
                          <div
                            className="text-xl font-bold text-text-secondary"
                            data-content-role="metric"
                            data-content-label="stopped-runs"
                          >
                            {stats.stoppedRuns}
                          </div>
                          <div
                            className="text-xs text-text-muted"
                            data-content-role="label"
                          >
                            Stopped
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Visual bar */}
                    {stats.totalRuns > 0 && (
                      <div className="mt-4">
                        <div className="flex h-3 rounded-full overflow-hidden bg-surface-canvas/50">
                          {stats.completedRuns > 0 && (
                            <div
                              className="bg-green-500 transition-all"
                              style={{
                                width: `${(stats.completedRuns / stats.totalRuns) * 100}%`,
                              }}
                            />
                          )}
                          {stats.failedRuns > 0 && (
                            <div
                              className="bg-red-500 transition-all"
                              style={{
                                width: `${(stats.failedRuns / stats.totalRuns) * 100}%`,
                              }}
                            />
                          )}
                          {stats.runningRuns > 0 && (
                            <div
                              className="bg-blue-500 transition-all"
                              style={{
                                width: `${(stats.runningRuns / stats.totalRuns) * 100}%`,
                              }}
                            />
                          )}
                          {stats.stoppedRuns > 0 && (
                            <div
                              className="bg-gray-500 transition-all"
                              style={{
                                width: `${(stats.stoppedRuns / stats.totalRuns) * 100}%`,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Duration Extremes */}
                {(stats.longestRun || stats.shortestRun) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {stats.longestRun && (
                      <Card className="bg-surface-raised/50 border-border-subtle/50">
                        <CardHeader>
                          <CardTitle className="text-base text-text-secondary">
                            Longest Run
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="font-medium text-text-primary">
                            {stats.longestRun.task_name}
                          </div>
                          <div className="text-2xl font-bold text-text-primary mt-1">
                            {formatDuration(stats.longestRun.duration_seconds)}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {stats.shortestRun && (
                      <Card className="bg-surface-raised/50 border-border-subtle/50">
                        <CardHeader>
                          <CardTitle className="text-base text-text-secondary">
                            Shortest Run
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="font-medium text-text-primary">
                            {stats.shortestRun.task_name}
                          </div>
                          <div className="text-2xl font-bold text-text-primary mt-1">
                            {formatDuration(stats.shortestRun.duration_seconds)}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}

                {/* Recent Runs with Duration */}
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="size-4" />
                      Recent Runs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border-subtle/50">
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>vs Avg</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(runs || []).slice(0, 15).map((run: TaskRun) => {
                            const diff =
                              run.duration_seconds != null
                                ? run.duration_seconds - stats.avgDuration
                                : null;
                            return (
                              <TableRow
                                key={run.id}
                                className="border-border-subtle/50 hover:bg-surface-raised/30 cursor-pointer"
                                onClick={() => router.push(`/runs/${run.id}`)}
                              >
                                <TableCell className="font-medium text-text-primary">
                                  {run.task_name}
                                </TableCell>
                                <TableCell>
                                  {run.status === "completed" ? (
                                    <Badge variant="success">Completed</Badge>
                                  ) : run.status === "failed" ? (
                                    <Badge variant="destructive">Failed</Badge>
                                  ) : run.status === "running" ? (
                                    <Badge variant="info">Running</Badge>
                                  ) : (
                                    <Badge variant="secondary">
                                      {run.status}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {formatDuration(run.duration_seconds)}
                                </TableCell>
                                <TableCell>
                                  {diff != null ? (
                                    <span
                                      className={`text-xs ${
                                        diff > 0
                                          ? "text-red-400"
                                          : "text-green-400"
                                      }`}
                                    >
                                      {diff > 0 ? "+" : ""}
                                      {formatDuration(diff)}
                                    </span>
                                  ) : (
                                    <span className="text-text-muted text-xs">
                                      -
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <ArrowRight className="size-4 text-text-muted" />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {viewMode === "performance" && (
              <>
                <div className="flex gap-1">
                  {["1h", "24h", "7d", "30d", "all"].map((range) => (
                    <Button
                      key={range}
                      variant={timeRange === range ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTimeRange(range)}
                      className={`text-xs ${
                        timeRange === range
                          ? "bg-brand-primary text-black"
                          : "border-border-default text-text-muted"
                      }`}
                    >
                      {range}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6 text-center">
                      <div
                        className="text-3xl font-bold text-text-primary"
                        data-content-role="metric"
                        data-content-label="perf-total-executions"
                      >
                        {stats.totalRuns}
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1"
                        data-content-role="label"
                      >
                        Total Executions
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6 text-center">
                      <div
                        className="text-3xl font-bold text-green-500"
                        data-content-role="metric"
                        data-content-label="perf-success-rate"
                      >
                        {stats.successRate.toFixed(0)}%
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1"
                        data-content-role="label"
                      >
                        Success Rate
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6 text-center">
                      <div
                        className="text-3xl font-bold text-text-primary"
                        data-content-role="metric"
                        data-content-label="perf-avg-duration"
                      >
                        {formatDuration(stats.avgDuration)}
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1"
                        data-content-role="label"
                      >
                        Avg Duration
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6 text-center">
                      <div
                        className="text-3xl font-bold text-text-primary"
                        data-content-role="metric"
                        data-content-label="perf-total-time"
                      >
                        {formatDuration(stats.totalDuration)}
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1"
                        data-content-role="label"
                      >
                        Total Time
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6 text-center">
                      <div
                        className="text-3xl font-bold text-blue-500"
                        data-content-role="metric"
                        data-content-label="perf-currently-running"
                      >
                        {stats.runningRuns}
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1"
                        data-content-role="label"
                      >
                        Currently Running
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardContent className="pt-6 text-center">
                      <div
                        className="text-3xl font-bold text-red-500"
                        data-content-role="metric"
                        data-content-label="perf-failed-runs"
                      >
                        {stats.failedRuns}
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1"
                        data-content-role="label"
                      >
                        Failed Runs
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
