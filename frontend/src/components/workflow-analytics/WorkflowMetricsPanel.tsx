/**
 * Workflow Metrics Panel Component
 *
 * Detailed metrics for a single workflow including:
 * - Overview cards (total runs, success rate, duration, last run)
 * - Complexity metrics with gauge visualization
 * - Execution history timeline
 * - Performance trends over time
 * - Success/failure breakdown
 */

"use client";

import React, { useMemo } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowMetrics } from "@/services/workflow-analytics-service";
import { ComplexityAnalysis } from "@/services/workflow-complexity-analyzer";
import { TestResult } from "@/services/workflow-testing-service";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
} from "recharts";
import {
  Activity,
  CheckCircle,
  Clock,
  XCircle,
  TrendingUp,
  TrendingDown,
  Gauge,
  Calendar,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowMetricsPanelProps {
  workflow: Workflow;
  metrics: WorkflowMetrics;
  complexityMetrics: ComplexityAnalysis;
  executionHistory: TestResult[];
  className?: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  subtitle?: string;
  variant?: "default" | "success" | "warning" | "error";
}

// ============================================================================
// Constants
// ============================================================================

const COMPLEXITY_COLORS = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#f97316",
  "very-high": "#ef4444",
};

const CHART_COLORS = {
  primary: "#3b82f6",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getComplexityColor(rating: string): string {
  return (
    COMPLEXITY_COLORS[rating as keyof typeof COMPLEXITY_COLORS] ||
    COMPLEXITY_COLORS.low
  );
}

// ============================================================================
// Metric Card Component
// ============================================================================

function MetricCard({
  title,
  value,
  icon,
  trend,
  subtitle,
  variant = "default",
}: MetricCardProps) {
  const variantStyles = {
    default: "border-border",
    success: "border-green-500/20 bg-green-500/5",
    warning: "border-orange-500/20 bg-orange-500/5",
    error: "border-red-500/20 bg-red-500/5",
  };

  return (
    <Card className={cn("relative overflow-hidden", variantStyles[variant])}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
        {trend !== undefined && trend !== 0 && (
          <div className="flex items-center mt-2 text-xs">
            {trend > 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
            )}
            <span className={cn(trend > 0 ? "text-green-500" : "text-red-500")}>
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)}% vs avg
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Complexity Gauge Component
// ============================================================================

function ComplexityGauge({ score, rating }: { score: number; rating: string }) {
  const data = [
    {
      name: "Complexity",
      value: score,
      fill: getComplexityColor(rating),
    },
  ];

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={200}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="90%"
          data={data}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar background dataKey="value" cornerRadius={10} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="text-center -mt-20">
        <div className="text-3xl font-bold">{score}</div>
        <div className="text-sm text-muted-foreground uppercase">{rating}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function WorkflowMetricsPanel({
  workflow,
  metrics,
  complexityMetrics,
  executionHistory,
  className,
}: WorkflowMetricsPanelProps) {
  // Calculate trends (comparing to average)
  const avgMetrics = useMemo(() => {
    // In a real implementation, this would come from aggregate stats
    return {
      avgSuccessRate: 0.85,
      avgDuration: 5000,
    };
  }, []);

  const successRateTrend = useMemo(() => {
    if (!avgMetrics.avgSuccessRate) return 0;
    return (
      ((metrics.successRate - avgMetrics.avgSuccessRate) /
        avgMetrics.avgSuccessRate) *
      100
    );
  }, [metrics.successRate, avgMetrics.avgSuccessRate]);

  const durationTrend = useMemo(() => {
    if (!avgMetrics.avgDuration) return 0;
    return (
      ((metrics.avgDuration - avgMetrics.avgDuration) /
        avgMetrics.avgDuration) *
      100
    );
  }, [metrics.avgDuration, avgMetrics.avgDuration]);

  // Execution history timeline data
  const timelineData = useMemo(() => {
    return executionHistory
      .slice(-30) // Last 30 executions
      .map((result, index) => ({
        index: index + 1,
        duration: result.duration,
        success: result.passed ? 1 : 0,
        failed: result.passed ? 0 : 1,
        timestamp: new Date(result.startTime).toLocaleString(),
      }));
  }, [executionHistory]);

  // Success/failure breakdown
  const breakdownData = useMemo(() => {
    return [
      {
        name: "Success",
        value: metrics.successfulExecutions,
        color: CHART_COLORS.success,
      },
      {
        name: "Failed",
        value: metrics.failedExecutions,
        color: CHART_COLORS.error,
      },
    ];
  }, [metrics]);

  // Performance trend data (duration over time)
  const performanceTrendData = useMemo(() => {
    return executionHistory.slice(-20).map((result, index) => ({
      run: `#${executionHistory.length - 20 + index + 1}`,
      duration: result.duration,
      avgDuration: metrics.avgDuration,
      timestamp: formatRelativeTime(result.startTime),
    }));
  }, [executionHistory, metrics.avgDuration]);

  // Success rate trend over time
  const successRateTrendData = useMemo(() => {
    const chunkSize = 5; // Calculate success rate for every 5 executions
    const chunks: Array<{ run: string; successRate: number; total: number }> =
      [];

    for (let i = 0; i < executionHistory.length; i += chunkSize) {
      const chunk = executionHistory.slice(i, i + chunkSize);
      const successful = chunk.filter((r) => r.passed).length;
      const rate = (successful / chunk.length) * 100;

      chunks.push({
        run: `${i + 1}-${Math.min(i + chunkSize, executionHistory.length)}`,
        successRate: rate,
        total: chunk.length,
      });
    }

    return chunks.slice(-10); // Last 10 chunks
  }, [executionHistory]);

  // Complexity metrics table data
  const complexityTableData = useMemo(() => {
    return [
      {
        metric: "Actions",
        value: complexityMetrics.actionCount,
        description: "Total number of actions",
      },
      {
        metric: "Connections",
        value: complexityMetrics.connectionCount,
        description: "Total connections",
      },
      {
        metric: "Max Depth",
        value: complexityMetrics.maxDepth,
        description: "Longest execution path",
      },
      {
        metric: "Branching Factor",
        value: complexityMetrics.branchingFactor.toFixed(2),
        description: "Avg branches per node",
      },
      {
        metric: "Cyclomatic Complexity",
        value: complexityMetrics.cyclomaticComplexity,
        description: "Decision points",
      },
      {
        metric: "Control Flow Actions",
        value: complexityMetrics.controlFlowCount || 0,
        description: "IF/LOOP/SWITCH actions",
      },
    ];
  }, [complexityMetrics]);

  // Recent runs
  const recentRuns = useMemo(() => {
    return executionHistory.slice(-10).reverse();
  }, [executionHistory]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div>
        <h3 className="text-2xl font-bold">{workflow.name}</h3>
        <p className="text-muted-foreground">
          {workflow.description || "Detailed metrics and performance analysis"}
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Runs"
          value={metrics.totalExecutions}
          icon={<Activity className="h-4 w-4" />}
          subtitle="All executions"
        />
        <MetricCard
          title="Success Rate"
          value={formatPercentage(metrics.successRate)}
          icon={<CheckCircle className="h-4 w-4" />}
          trend={successRateTrend}
          subtitle={`${metrics.successfulExecutions} / ${metrics.totalExecutions}`}
          variant={
            metrics.successRate > 0.9
              ? "success"
              : metrics.successRate > 0.7
                ? "warning"
                : "error"
          }
        />
        <MetricCard
          title="Avg Duration"
          value={formatDuration(metrics.avgDuration)}
          icon={<Clock className="h-4 w-4" />}
          trend={-durationTrend} // Negative is good for duration
          subtitle={`Min: ${formatDuration(metrics.minDuration)} / Max: ${formatDuration(metrics.maxDuration)}`}
        />
        <MetricCard
          title="Last Run"
          value={
            metrics.lastExecuted
              ? formatRelativeTime(metrics.lastExecuted)
              : "Never"
          }
          icon={<Calendar className="h-4 w-4" />}
          subtitle={
            metrics.lastExecuted
              ? new Date(metrics.lastExecuted).toLocaleString()
              : "No executions yet"
          }
        />
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="complexity" className="space-y-4">
        <TabsList>
          <TabsTrigger value="complexity">Complexity</TabsTrigger>
          <TabsTrigger value="history">Execution History</TabsTrigger>
          <TabsTrigger value="trends">Performance Trends</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
        </TabsList>

        {/* Complexity Tab */}
        <TabsContent value="complexity" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Complexity Gauge */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="h-5 w-5" />
                  Complexity Score
                </CardTitle>
                <CardDescription>
                  Overall workflow complexity rating
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ComplexityGauge
                  score={complexityMetrics.complexityScore}
                  rating={complexityMetrics.complexityRating}
                />
                <Separator className="my-4" />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rating:</span>
                    <Badge
                      variant="outline"
                      style={{
                        borderColor: getComplexityColor(
                          complexityMetrics.complexityRating
                        ),
                      }}
                    >
                      {complexityMetrics.complexityRating.toUpperCase()}
                    </Badge>
                  </div>
                  {complexityMetrics.hasCycles && (
                    <div className="flex items-center gap-2 text-orange-500">
                      <AlertCircle className="h-4 w-4" />
                      <span>Contains cycles (loops)</span>
                    </div>
                  )}
                  {complexityMetrics.disconnectedComponents > 1 && (
                    <div className="flex items-center gap-2 text-orange-500">
                      <AlertCircle className="h-4 w-4" />
                      <span>
                        {complexityMetrics.disconnectedComponents} disconnected
                        components
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Complexity Metrics Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Metrics</CardTitle>
                <CardDescription>Complexity breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-3">
                    {complexityTableData.map((item) => (
                      <div key={item.metric} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {item.metric}
                          </span>
                          <span className="text-sm font-bold">
                            {item.value}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {item.description}
                        </p>
                        <Separator />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Execution History Tab */}
        <TabsContent value="history" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Timeline Chart */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Execution Timeline</CardTitle>
                <CardDescription>Last 30 execution runs</CardDescription>
              </CardHeader>
              <CardContent>
                {timelineData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={timelineData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="index" />
                      <YAxis />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === "duration") return formatDuration(Number(value));
                          return value;
                        }}
                        labelFormatter={(label) => `Run #${label}`}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="duration"
                        stroke={CHART_COLORS.primary}
                        fill={CHART_COLORS.primary}
                        fillOpacity={0.3}
                        name="Duration (ms)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No execution history available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Runs List */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Recent Runs</CardTitle>
                <CardDescription>Last 10 executions</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {recentRuns.map((result, index) => (
                      <div
                        key={result.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          {result.passed ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                Run #{executionHistory.length - index}
                              </span>
                              <Badge
                                variant={
                                  result.passed ? "default" : "destructive"
                                }
                                className="text-xs"
                              >
                                {result.passed ? "Success" : "Failed"}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatRelativeTime(result.startTime)} •{" "}
                              {formatDuration(result.duration)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {recentRuns.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No execution history available
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Performance Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          {/* Duration Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Duration Over Time</CardTitle>
              <CardDescription>Last 20 executions</CardDescription>
            </CardHeader>
            <CardContent>
              {performanceTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={performanceTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="run" />
                    <YAxis tickFormatter={(value) => formatDuration(Number(value))} />
                    <Tooltip
                      formatter={(value) => formatDuration(Number(value))}
                      labelFormatter={(label) => `Run ${label}`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="duration"
                      stroke={CHART_COLORS.primary}
                      strokeWidth={2}
                      name="Duration"
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgDuration"
                      stroke={CHART_COLORS.warning}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="Average"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  Insufficient data for trend analysis
                </div>
              )}
            </CardContent>
          </Card>

          {/* Success Rate Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Success Rate Trend</CardTitle>
              <CardDescription>
                Success rate over execution batches
              </CardDescription>
            </CardHeader>
            <CardContent>
              {successRateTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={successRateTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="run" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip
                      formatter={(value) => `${Number(value).toFixed(1)}%`}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="successRate"
                      stroke={CHART_COLORS.success}
                      fill={CHART_COLORS.success}
                      fillOpacity={0.3}
                      name="Success Rate %"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  Insufficient data for trend analysis
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Breakdown Tab */}
        <TabsContent value="breakdown" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Success/Failure Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Success vs Failure</CardTitle>
                <CardDescription>
                  Execution outcome distribution
                </CardDescription>
              </CardHeader>
              <CardContent>
                {metrics.totalExecutions > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={breakdownData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value, percent }) =>
                          `${name}: ${value} (${((percent ?? 0) * 100).toFixed(0)}%)`
                        }
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {breakdownData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                    No execution data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Statistics Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Statistics Summary</CardTitle>
                <CardDescription>Key performance indicators</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Success Rate</span>
                    <span className="font-medium">
                      {formatPercentage(metrics.successRate)}
                    </span>
                  </div>
                  <Progress value={metrics.successRate * 100} className="h-2" />
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Min Duration</span>
                    <span className="font-medium">
                      {formatDuration(metrics.minDuration)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Avg Duration</span>
                    <span className="font-medium">
                      {formatDuration(metrics.avgDuration)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Max Duration</span>
                    <span className="font-medium">
                      {formatDuration(metrics.maxDuration)}
                    </span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Total Executions
                    </span>
                    <span className="font-medium">
                      {metrics.totalExecutions}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Successful</span>
                    <span className="font-medium text-green-500">
                      {metrics.successfulExecutions}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Failed</span>
                    <span className="font-medium text-red-500">
                      {metrics.failedExecutions}
                    </span>
                  </div>
                </div>

                {metrics.firstExecuted && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">First Run</span>
                        <span className="font-medium">
                          {formatRelativeTime(metrics.firstExecuted)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Last Run</span>
                        <span className="font-medium">
                          {metrics.lastExecuted
                            ? formatRelativeTime(metrics.lastExecuted)
                            : "Never"}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default WorkflowMetricsPanel;
