"use client";

import { useMemo } from "react";
import { useTaskRunList, useFindingsSummary } from "@/hooks/useTaskRunData";
import type { TaskRunView } from "@/lib/task-run-mappers";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  Tag,
  BarChart3,
  Repeat,
  Layers,
  AlertTriangle,
  Inbox,
} from "lucide-react";

interface IterationTrend {
  avgIterations: number;
  trend: "increasing" | "decreasing" | "stable";
  recentAvg: number;
  olderAvg: number;
}

interface PatternInsight {
  label: string;
  description: string;
  type: "positive" | "negative" | "neutral";
}

function computeIterationTrend(runs: TaskRunView[]): IterationTrend {
  const withIterations = runs.filter(
    (r) => r.iteration_count != null && r.iteration_count > 0
  );
  if (withIterations.length < 2) {
    return { avgIterations: 0, trend: "stable", recentAvg: 0, olderAvg: 0 };
  }

  const avg =
    withIterations.reduce((sum, r) => sum + (r.iteration_count || 0), 0) /
    withIterations.length;

  const half = Math.floor(withIterations.length / 2);
  const recent = withIterations.slice(0, half);
  const older = withIterations.slice(half);

  const recentAvg =
    recent.reduce((sum, r) => sum + (r.iteration_count || 0), 0) /
    recent.length;
  const olderAvg =
    older.reduce((sum, r) => sum + (r.iteration_count || 0), 0) / older.length;

  const diff = recentAvg - olderAvg;
  const threshold = olderAvg * 0.15;

  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (diff > threshold) trend = "increasing";
  if (diff < -threshold) trend = "decreasing";

  return { avgIterations: avg, trend, recentAvg, olderAvg };
}

function derivePatternInsights(
  runs: TaskRunView[],
  findingsTotal: number
): PatternInsight[] {
  const insights: PatternInsight[] = [];

  const completed = runs.filter((r) => r.status === "completed");
  const failed = runs.filter((r) => r.status === "failed");

  if (runs.length >= 3) {
    const recentThree = runs.slice(0, 3);
    const allCompleted = recentThree.every((r) => r.status === "completed");
    const allFailed = recentThree.every((r) => r.status === "failed");

    if (allCompleted) {
      insights.push({
        label: "Winning Streak",
        description: "The last 3 runs all completed successfully.",
        type: "positive",
      });
    }
    if (allFailed) {
      insights.push({
        label: "Recurring Failures",
        description:
          "The last 3 runs all failed. Consider reviewing the configuration.",
        type: "negative",
      });
    }
  }

  if (completed.length > 0 && failed.length > 0) {
    const avgCompletedDuration =
      completed.reduce((sum, r) => sum + (r.duration_seconds || 0), 0) /
      completed.length;
    const avgFailedDuration =
      failed.reduce((sum, r) => sum + (r.duration_seconds || 0), 0) /
      failed.length;

    if (avgFailedDuration > 0 && avgCompletedDuration > avgFailedDuration * 2) {
      insights.push({
        label: "Successful runs take longer",
        description: `Completed runs average ${Math.round(avgCompletedDuration)}s vs ${Math.round(avgFailedDuration)}s for failed. Failures may be detected early.`,
        type: "neutral",
      });
    }
  }

  const finishedCount = completed.length + failed.length;
  if (finishedCount > 0) {
    const successRate = (completed.length / finishedCount) * 100;
    if (successRate >= 90) {
      insights.push({
        label: "High success rate",
        description: `${successRate.toFixed(0)}% success rate across ${finishedCount} finished runs.`,
        type: "positive",
      });
    } else if (successRate <= 30) {
      insights.push({
        label: "Low success rate",
        description: `Only ${successRate.toFixed(0)}% success rate. Review task configurations.`,
        type: "negative",
      });
    }
  }

  if (findingsTotal > 0 && runs.length > 0) {
    const findingsPerRun = findingsTotal / runs.length;
    if (findingsPerRun > 5) {
      insights.push({
        label: "High findings density",
        description: `Averaging ${findingsPerRun.toFixed(1)} findings per run. Focus on resolving common issues.`,
        type: "negative",
      });
    } else if (findingsPerRun < 1) {
      insights.push({
        label: "Clean executions",
        description: `Low findings count (${findingsPerRun.toFixed(1)} per run) suggests stable execution.`,
        type: "positive",
      });
    }
  }

  // Phase distribution insight
  const phases = runs.reduce(
    (acc, r) => {
      if (r.phase) {
        acc[r.phase] = (acc[r.phase] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );
  const phaseEntries = Object.entries(phases);
  if (phaseEntries.length > 0) {
    const sorted = phaseEntries.sort(([, a], [, b]) => b - a);
    const mostCommon = sorted[0];
    if (mostCommon) {
      const [phaseName, phaseCount] = mostCommon;
      insights.push({
        label: `Most common phase: ${phaseName}`,
        description: `${phaseCount} runs ended in the "${phaseName}" phase.`,
        type: "neutral",
      });
    }
  }

  return insights;
}

export default function LearningPage() {
  const {
    data: runs,
    isLoading: runsLoading,
    error: runsError,
    isRunnerOffline: runsOffline,
    refetch: refetchRuns,
  } = useTaskRunList({ limit: 50 });
  const {
    data: findingsData,
    isLoading: findingsLoading,
    isRunnerOffline: findingsOffline,
  } = useFindingsSummary();

  const isOffline = runsOffline || findingsOffline;
  const isLoading = runsLoading || findingsLoading;

  const iterationTrend = useMemo(() => {
    if (!runs) return null;
    return computeIterationTrend(runs);
  }, [runs]);

  const insights = useMemo(() => {
    if (!runs) return [];
    return derivePatternInsights(runs, findingsData?.total || 0);
  }, [runs, findingsData]);

  const topCategories = useMemo(() => {
    if (!findingsData?.by_category) return [];
    return Object.entries(findingsData.by_category)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 8);
  }, [findingsData]);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Learning Insights</h1>
        <Button variant="outline" size="sm" onClick={() => refetchRuns()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          ML-style insights derived from task run patterns, iteration trends,
          and finding distributions.
        </p>

        {isOffline && <RunnerPartialState />}

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Analyzing patterns...
          </div>
        ) : runsError ? (
          <div className="text-center py-16 text-red-400">
            Error: {runsError?.message ?? "Unknown error"}
          </div>
        ) : !runs || runs.length === 0 ? (
          <Card className="bg-muted border-border">
            <CardContent className="py-16">
              <div className="text-center text-muted-foreground">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-muted-foreground mb-2"
                >
                  No Data for Analysis
                </h3>
                <p className="text-sm">
                  Run tasks in the Runner to generate insights and pattern
                  analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Iteration Trend */}
            {iterationTrend && iterationTrend.avgIterations > 0 && (
              <Card className="bg-muted border-border">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Repeat className="size-4 text-primary" />
                    Iteration Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center">
                      <div
                        data-content-role="metric"
                        data-content-label="average iterations"
                        className="text-3xl font-bold text-foreground"
                      >
                        {iterationTrend.avgIterations.toFixed(1)}
                      </div>
                      <div
                        data-content-role="label"
                        data-content-label="average iterations label"
                        className="text-xs text-muted-foreground mt-1"
                      >
                        Avg Iterations / Run
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {iterationTrend.trend === "decreasing" ? (
                          <TrendingDown className="size-5 text-green-500" />
                        ) : iterationTrend.trend === "increasing" ? (
                          <TrendingUp className="size-5 text-red-500" />
                        ) : (
                          <Minus className="size-5 text-muted-foreground" />
                        )}
                        <span
                          data-content-role="status"
                          data-content-label="iteration trend"
                          className={`text-lg font-semibold ${
                            iterationTrend.trend === "decreasing"
                              ? "text-green-500"
                              : iterationTrend.trend === "increasing"
                                ? "text-red-500"
                                : "text-muted-foreground"
                          }`}
                        >
                          {iterationTrend.trend === "stable"
                            ? "Stable"
                            : iterationTrend.trend === "decreasing"
                              ? "Decreasing"
                              : "Increasing"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Trend
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-muted-foreground">
                        Recent: {iterationTrend.recentAvg.toFixed(1)} &middot;
                        Older: {iterationTrend.olderAvg.toFixed(1)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Comparison (recent vs older half)
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pattern Insights */}
            {insights.length > 0 && (
              <Card className="bg-muted border-border">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="size-4 text-purple-400" />
                    Pattern Detection
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {insights.map((insight, i) => (
                      <div
                        key={i}
                        className={`p-4 rounded-lg border ${
                          insight.type === "positive"
                            ? "bg-green-500/5 border-green-500/20"
                            : insight.type === "negative"
                              ? "bg-red-500/5 border-red-500/20"
                              : "bg-background border-border"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          {insight.type === "positive" ? (
                            <TrendingUp className="size-4 text-green-500" />
                          ) : insight.type === "negative" ? (
                            <AlertTriangle className="size-4 text-red-500" />
                          ) : (
                            <BarChart3 className="size-4 text-muted-foreground" />
                          )}
                          <span
                            data-content-role="label"
                            data-content-label="insight title"
                            className="font-medium text-sm text-foreground"
                          >
                            {insight.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {insight.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Finding Categories */}
            {topCategories.length > 0 && (
              <Card className="bg-muted border-border">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Tag className="size-4 text-yellow-500" />
                    Top Finding Categories
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {topCategories.map(([category, count]) => {
                      const maxCount = topCategories[0]
                        ? (topCategories[0][1] as number)
                        : 1;
                      const percentage = ((count as number) / maxCount) * 100;
                      return (
                        <div key={category}>
                          <div className="flex items-center justify-between mb-1">
                            <span
                              data-content-role="label"
                              data-content-label="finding category"
                              className="text-sm text-foreground"
                            >
                              {category}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {count as number}
                            </Badge>
                          </div>
                          <div className="h-2 rounded-full bg-background overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary/60 transition-all"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Phase Distribution */}
            <Card className="bg-muted border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="size-4 text-blue-400" />
                  Phase Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const phases = runs.reduce(
                    (acc, r) => {
                      const phase = r.phase || "unknown";
                      acc[phase] = (acc[phase] || 0) + 1;
                      return acc;
                    },
                    {} as Record<string, number>
                  );
                  const entries = Object.entries(phases).sort(
                    ([, a], [, b]) => b - a
                  );

                  if (entries.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        No phase data available.
                      </p>
                    );
                  }

                  return (
                    <div className="flex flex-wrap gap-3">
                      {entries.map(([phase, count]) => (
                        <div
                          key={phase}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border"
                        >
                          <Badge variant="outline" className="text-xs">
                            {phase}
                          </Badge>
                          <span
                            data-content-role="metric"
                            data-content-label="phase count"
                            className="text-sm font-medium text-foreground"
                          >
                            {count}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
