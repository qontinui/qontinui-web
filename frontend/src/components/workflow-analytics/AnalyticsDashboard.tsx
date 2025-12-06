/**
 * Analytics Dashboard Component
 *
 * Comprehensive analytics dashboard for workflow monitoring with:
 * - Time range selector
 * - Key metrics cards
 * - Execution timeline charts
 * - Success rate and duration charts
 * - Top workflows tables
 * - Folder/tag filtering
 * - Export functionality
 */

"use client";

import React, { useState, useMemo } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowMetrics,
} from "@/services/workflow-analytics-service";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Calendar,
  Download,
  RefreshCw,
  Activity,
  CheckCircle,
  Clock,
  Workflow as WorkflowIcon,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Filter,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsDashboardProps {
  workflows: Workflow[];
  metrics: Record<string, WorkflowMetrics>;
  timeRange: { start: Date; end: Date };
  onTimeRangeChange: (range: { start: Date; end: Date }) => void;
  className?: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  description?: string;
  className?: string;
}

// ============================================================================
// Time Range Presets
// ============================================================================

const TIME_RANGES = {
  today: () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  },
  week: () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return { start, end };
  },
  month: () => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    return { start, end };
  },
  quarter: () => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    return { start, end };
  },
  year: () => {
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    return { start, end };
  },
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

function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

// ============================================================================
// Metric Card Component
// ============================================================================

function MetricCard({
  title,
  value,
  icon,
  trend,
  description,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend !== undefined && (
          <div className="flex items-center mt-2 text-xs">
            {trend > 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
            ) : trend < 0 ? (
              <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
            ) : null}
            <span
              className={cn(
                trend > 0
                  ? "text-green-500"
                  : trend < 0
                    ? "text-red-500"
                    : "text-muted-foreground"
              )}
            >
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)}% from last period
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export function AnalyticsDashboard({
  workflows,
  metrics,
  timeRange,
  onTimeRangeChange,
  className,
}: AnalyticsDashboardProps) {
  const [selectedFolder, setSelectedFolder] = useState<string>("all");

  // Calculate aggregated metrics
  const aggregatedMetrics = useMemo(() => {
    const metricsArray = Object.values(metrics);

    // Filter by folder if selected
    const filteredMetrics =
      selectedFolder === "all"
        ? metricsArray
        : metricsArray.filter((m) => m.folderId === selectedFolder);

    const totalExecutions = filteredMetrics.reduce(
      (sum, m) => sum + m.totalExecutions,
      0
    );
    const totalSuccessful = filteredMetrics.reduce(
      (sum, m) => sum + m.successfulExecutions,
      0
    );
    const totalFailed = filteredMetrics.reduce(
      (sum, m) => sum + m.failedExecutions,
      0
    );
    const avgSuccessRate =
      filteredMetrics.length > 0
        ? filteredMetrics.reduce((sum, m) => sum + m.successRate, 0) /
          filteredMetrics.length
        : 0;
    const avgDuration =
      filteredMetrics.length > 0
        ? filteredMetrics.reduce((sum, m) => sum + m.avgDuration, 0) /
          filteredMetrics.length
        : 0;

    return {
      totalExecutions,
      totalSuccessful,
      totalFailed,
      avgSuccessRate,
      avgDuration,
      totalWorkflows: filteredMetrics.length,
    };
  }, [metrics, selectedFolder]);

  // Top workflows
  const topWorkflows = useMemo(() => {
    const metricsArray = Object.values(metrics);
    const sortedByExecutions = [...metricsArray]
      .sort((a, b) => b.totalExecutions - a.totalExecutions)
      .slice(0, 5);
    const slowest = [...metricsArray]
      .filter((m) => m.totalExecutions > 0)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 5);
    const highestError = [...metricsArray]
      .filter((m) => m.totalExecutions > 0 && m.failedExecutions > 0)
      .sort((a, b) => 1 - b.successRate - (1 - a.successRate))
      .slice(0, 5);

    return {
      mostExecuted: sortedByExecutions,
      slowest,
      highestError,
    };
  }, [metrics]);

  // Timeline data
  const timelineData = useMemo(() => {
    const metricsArray = Object.values(metrics);
    const data: Array<{
      name: string;
      executions: number;
      success: number;
      failed: number;
    }> = [];

    // Group by day for the selected time range
    const daysDiff = Math.ceil(
      (timeRange.end.getTime() - timeRange.start.getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const points = Math.min(daysDiff, 30); // Max 30 data points

    for (let i = 0; i < points; i++) {
      const date = new Date(
        timeRange.start.getTime() +
          (i * (timeRange.end.getTime() - timeRange.start.getTime())) / points
      );
      data.push({
        name: date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        executions: Math.floor(Math.random() * 100), // TODO: Replace with actual data
        success: Math.floor(Math.random() * 80),
        failed: Math.floor(Math.random() * 20),
      });
    }

    return data;
  }, [timeRange]);

  // Success rate by workflow data
  const successRateData = useMemo(() => {
    return Object.values(metrics)
      .filter((m) => m.totalExecutions > 0)
      .sort((a, b) => b.totalExecutions - a.totalExecutions)
      .slice(0, 10)
      .map((m) => ({
        name:
          m.workflowName.length > 20
            ? m.workflowName.substring(0, 20) + "..."
            : m.workflowName,
        successRate: m.successRate * 100,
        executions: m.totalExecutions,
      }));
  }, [metrics]);

  // Duration by workflow data
  const durationData = useMemo(() => {
    return Object.values(metrics)
      .filter((m) => m.totalExecutions > 0)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 10)
      .map((m) => ({
        name:
          m.workflowName.length > 20
            ? m.workflowName.substring(0, 20) + "..."
            : m.workflowName,
        duration: m.avgDuration,
        minDuration: m.minDuration,
        maxDuration: m.maxDuration,
      }));
  }, [metrics]);

  // Handle time range change
  const handleTimeRangeChange = (preset: string) => {
    if (preset === "custom") {
      // TODO: Open custom date picker
      return;
    }

    const rangeFunc = TIME_RANGES[preset as keyof typeof TIME_RANGES];
    if (rangeFunc) {
      onTimeRangeChange(rangeFunc());
    }
  };

  // Handle export
  const handleExport = () => {
    const exportData = {
      generated: new Date().toISOString(),
      timeRange,
      metrics: aggregatedMetrics,
      workflows: Object.values(metrics),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-analytics-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Analytics Dashboard
          </h2>
          <p className="text-muted-foreground">
            Monitor workflow performance and execution metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select onValueChange={handleTimeRangeChange} defaultValue="week">
            <SelectTrigger className="w-[180px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Select time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
              <SelectItem value="quarter">Last 3 months</SelectItem>
              <SelectItem value="year">Last year</SelectItem>
              <SelectItem value="custom">Custom range...</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      {selectedFolder !== "all" && (
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Active filters:</span>
          <Badge variant="secondary" className="gap-1">
            Folder: {selectedFolder}
            <X
              className="h-3 w-3 cursor-pointer"
              onClick={() => setSelectedFolder("all")}
            />
          </Badge>
        </div>
      )}

      {/* Key Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Executions"
          value={formatNumber(aggregatedMetrics.totalExecutions)}
          icon={<Activity className="h-4 w-4" />}
          description="All workflow runs"
        />
        <MetricCard
          title="Success Rate"
          value={formatPercentage(aggregatedMetrics.avgSuccessRate)}
          icon={<CheckCircle className="h-4 w-4" />}
          description={`${aggregatedMetrics.totalSuccessful} successful, ${aggregatedMetrics.totalFailed} failed`}
        />
        <MetricCard
          title="Avg Duration"
          value={formatDuration(aggregatedMetrics.avgDuration)}
          icon={<Clock className="h-4 w-4" />}
          description="Average execution time"
        />
        <MetricCard
          title="Total Workflows"
          value={aggregatedMetrics.totalWorkflows}
          icon={<WorkflowIcon className="h-4 w-4" />}
          description={`${workflows.length} total workflows`}
        />
      </div>

      {/* Charts Section */}
      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList>
          <TabsTrigger value="timeline">Execution Timeline</TabsTrigger>
          <TabsTrigger value="success">Success Rates</TabsTrigger>
          <TabsTrigger value="duration">Duration Analysis</TabsTrigger>
          <TabsTrigger value="usage">Usage Patterns</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution Timeline</CardTitle>
              <CardDescription>Workflow executions over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="executions"
                    stroke="#3b82f6"
                    name="Total"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="success"
                    stroke="#10b981"
                    name="Success"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="failed"
                    stroke="#ef4444"
                    name="Failed"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="success" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Success Rate by Workflow</CardTitle>
              <CardDescription>
                Top 10 workflows by execution count
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={successRateData} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis type="category" dataKey="name" width={150} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="successRate"
                    fill="#10b981"
                    name="Success Rate %"
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Average Duration by Workflow</CardTitle>
              <CardDescription>Top 10 slowest workflows</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={durationData} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={150} />
                  <Tooltip
                    formatter={(value: number) => formatDuration(value)}
                    labelFormatter={(label) => `Workflow: ${label}`}
                  />
                  <Legend />
                  <Bar dataKey="duration" fill="#3b82f6" name="Avg Duration" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Usage Distribution</CardTitle>
              <CardDescription>Most and least used workflows</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={topWorkflows.mostExecuted}
                  layout="horizontal"
                  margin={{ left: 100 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis
                    type="category"
                    dataKey="workflowName"
                    width={150}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="totalExecutions"
                    fill="#8b5cf6"
                    name="Executions"
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Top Workflows Tables */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Most Executed */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most Executed</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {topWorkflows.mostExecuted.map((metric, index) => (
                  <div
                    key={metric.workflowId}
                    className="flex items-center justify-between p-2 rounded hover:bg-accent"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-medium text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="text-sm truncate">
                        {metric.workflowName}
                      </span>
                    </div>
                    <Badge variant="secondary">{metric.totalExecutions}</Badge>
                  </div>
                ))}
                {topWorkflows.mostExecuted.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No data available
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Slowest */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Slowest Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {topWorkflows.slowest.map((metric, index) => (
                  <div
                    key={metric.workflowId}
                    className="flex items-center justify-between p-2 rounded hover:bg-accent"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-medium text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="text-sm truncate">
                        {metric.workflowName}
                      </span>
                    </div>
                    <Badge variant="outline">
                      {formatDuration(metric.avgDuration)}
                    </Badge>
                  </div>
                ))}
                {topWorkflows.slowest.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No data available
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Highest Error Rate */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Highest Error Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {topWorkflows.highestError.map((metric, index) => (
                  <div
                    key={metric.workflowId}
                    className="flex items-center justify-between p-2 rounded hover:bg-accent"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-medium text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="text-sm truncate">
                        {metric.workflowName}
                      </span>
                    </div>
                    <Badge variant="destructive">
                      {formatPercentage(1 - metric.successRate)}
                    </Badge>
                  </div>
                ))}
                {topWorkflows.highestError.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No failures detected
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default AnalyticsDashboard;
