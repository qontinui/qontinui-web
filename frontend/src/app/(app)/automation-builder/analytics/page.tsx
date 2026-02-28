/**
 * Workflow Analytics Page
 *
 * Comprehensive analytics and performance monitoring for workflows:
 * - Overview metrics and KPIs
 * - Interactive charts and visualizations
 * - Top workflows analysis (most executed, slowest, highest error rate)
 * - Performance analysis and optimization suggestions
 * - Workflow comparison tool
 * - Detailed execution logs
 * - Filters and export functionality
 * - Real-time data updates
 */

"use client";

import { RequireProject } from "@/components/require-project";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Calendar,
  Download,
  RefreshCw,
  Activity,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Filter,
  X,
  BarChart3,
  FileDown,
  Search,
  Eye,
  ArrowUpDown,
  ChevronRight,
  Zap,
  Info,
  ArrowLeft,
} from "lucide-react";
import { AnalyticsDashboard } from "@/components/workflow-analytics/AnalyticsDashboard";
import { WorkflowMetricsPanel } from "@/components/workflow-analytics/WorkflowMetricsPanel";
import { PerformanceAnalyzer } from "@/components/workflow-analytics/PerformanceAnalyzer";
import {
  workflowAnalyticsService,
  ExecutionRecord,
} from "@/services/workflow-analytics-service";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { ComplexityAnalysis } from "@/services/workflow-complexity-analyzer";
import type { TestResult } from "@/services/workflow-testing-service";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

type TimeRangePreset =
  | "today"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "custom";

interface FilterState {
  folder?: string;
  tag?: string;
  category?: string;
  status?: "success" | "failure" | "all";
  complexityLevel?: "low" | "medium" | "high" | "very-high" | "all";
  searchQuery?: string;
}

// ============================================================================
// Time Range Utilities
// ============================================================================

const TIME_RANGES: Record<TimeRangePreset, () => { start: Date; end: Date }> = {
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
  custom: () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
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

function getComplexityLevel(
  actionCount: number
): "low" | "medium" | "high" | "very-high" {
  if (actionCount <= 5) return "low";
  if (actionCount <= 10) return "medium";
  if (actionCount <= 20) return "high";
  return "very-high";
}

// ============================================================================
// Metric Card Component
// ============================================================================

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  description?: string;
  variant?: "default" | "success" | "warning" | "error";
  color?: string;
}

function MetricCard({
  title,
  value,
  icon,
  trend,
  description,
  variant = "default",
  color,
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
        <div className="text-muted-foreground" style={color ? { color } : {}}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" style={color ? { color } : {}}>
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
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
              {trend.toFixed(1)}% vs previous period
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Execution Table Component
// ============================================================================

interface ExecutionTableProps {
  executions: ExecutionRecord[];
  onRowClick?: (execution: ExecutionRecord) => void;
}

function ExecutionTable({ executions, onRowClick }: ExecutionTableProps) {
  const [sortBy, setSortBy] = useState<
    "startTime" | "duration" | "workflowName"
  >("startTime");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const sortedExecutions = useMemo(() => {
    return [...executions].sort((a, b) => {
      let aVal: unknown = a[sortBy];
      let bVal: unknown = b[sortBy];

      if (sortBy === "startTime") {
        aVal = new Date(aVal as string | number | Date).getTime();
        bVal = new Date(bVal as string | number | Date).getTime();
      }

      if (sortOrder === "asc") {
        return (aVal as number) > (bVal as number) ? 1 : -1;
      } else {
        return (aVal as number) < (bVal as number) ? 1 : -1;
      }
    });
  }, [executions, sortBy, sortOrder]);

  const paginatedExecutions = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedExecutions.slice(start, start + itemsPerPage);
  }, [sortedExecutions, currentPage]);

  const totalPages = Math.ceil(executions.length / itemsPerPage);

  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("workflowName")}
                    className="hover:bg-transparent"
                  >
                    Workflow
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("startTime")}
                    className="hover:bg-transparent"
                  >
                    Timestamp
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("duration")}
                    className="hover:bg-transparent"
                  >
                    Duration
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  Status
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedExecutions.map((execution) => (
                <tr
                  key={execution.id}
                  className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                  onClick={() => onRowClick?.(execution)}
                >
                  <td className="p-4 align-middle">
                    <div className="font-medium">{execution.workflowName}</div>
                    <div className="text-xs text-muted-foreground">
                      {execution.workflowId.substring(0, 8)}...
                    </div>
                  </td>
                  <td className="p-4 align-middle">
                    <div className="text-sm">
                      {new Date(execution.startTime).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(execution.startTime)}
                    </div>
                  </td>
                  <td className="p-4 align-middle">
                    <Badge variant="outline">
                      {formatDuration(execution.duration)}
                    </Badge>
                  </td>
                  <td className="p-4 align-middle">
                    {execution.success ? (
                      <Badge
                        variant="default"
                        className="bg-green-500/20 text-green-400 border-green-500/30"
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    )}
                  </td>
                  <td className="p-4 align-middle">
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, executions.length)} of{" "}
            {executions.length} executions
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function WorkflowAnalyticsPage() {
  const router = useRouter();

  // State
  const [timeRange, setTimeRange] = useState<{ start: Date; end: Date }>(
    TIME_RANGES.week()
  );
  const [timeRangePreset, setTimeRangePreset] =
    useState<TimeRangePreset>("week");
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    complexityLevel: "all",
  });
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [comparisonWorkflows] = useState<string[]>([]);
  const [selectedExecution, setSelectedExecution] =
    useState<ExecutionRecord | null>(null);

  // Load data - refreshKey forces re-fetch when data is refreshed
  const allMetrics = useMemo(
    () => workflowAnalyticsService.getAllMetrics(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey]
  );

  const aggregatedStats = useMemo(
    () => workflowAnalyticsService.getAggregatedStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey]
  );

  const recentExecutions = useMemo(
    () => workflowAnalyticsService.getRecentExecutions(100),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey]
  );

  // Executions filtered by the selected time range
  const timeRangeExecutions = useMemo(
    () =>
      workflowAnalyticsService.getExecutionsInDateRange(
        timeRange.start,
        timeRange.end
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey, timeRange]
  );

  // Filter metrics
  const filteredMetrics = useMemo(() => {
    let filtered = allMetrics;

    if (filters.folder) {
      filtered = filtered.filter((m) => m.folderId === filters.folder);
    }

    if (filters.status === "success") {
      filtered = filtered.filter((m) => m.successRate === 1);
    } else if (filters.status === "failure") {
      filtered = filtered.filter((m) => m.failedExecutions > 0);
    }

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter((m) =>
        m.workflowName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [allMetrics, filters]);

  // Top workflows - refreshKey forces re-fetch when data is refreshed
  const topWorkflows = useMemo(
    () => {
      const mostExecuted = workflowAnalyticsService.getMostUsedWorkflows(10);
      const slowest = workflowAnalyticsService.getSlowestWorkflows(10);
      const highestError =
        workflowAnalyticsService.getHighestErrorRateWorkflows(10);
      const recentlyFailed = recentExecutions
        .filter((e) => !e.success)
        .slice(0, 10);

      return {
        mostExecuted,
        slowest,
        highestError,
        recentlyFailed,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey, recentExecutions]
  );

  // Selected workflow data
  const selectedWorkflowData = useMemo(() => {
    if (!selectedWorkflow) return null;
    const metrics = allMetrics.find((m) => m.workflowId === selectedWorkflow);
    if (!metrics) return null;

    // Mock workflow and complexity data
    const workflow: Workflow = {
      id: selectedWorkflow,
      name: metrics.workflowName,
      description: "",
      version: "1.0.0",
      format: "graph",
      actions: [],
      connections: {},
      metadata: {},
    };

    const complexityMetrics: ComplexityAnalysis = {
      actionCount: 10,
      connectionCount: 12,
      maxDepth: 5,
      branchingFactor: 1.2,
      cyclomaticComplexity: 3,
      complexityScore: 6,
      complexityRating: getComplexityLevel(10),
      hasCycles: false,
      disconnectedComponents: 1,
      controlFlowCount: 2,
    };

    const executionHistory: TestResult[] = recentExecutions
      .filter((e) => e.workflowId === selectedWorkflow)
      .map((e) => ({
        id: e.id,
        testCaseId: e.id,
        testCaseName: e.workflowName,
        workflowId: e.workflowId,
        workflowName: e.workflowName,
        passed: e.success,
        startTime: e.startTime,
        endTime: e.endTime,
        duration: e.duration,
        assertions: [],
        error: e.error,
      }));

    return { workflow, metrics, complexityMetrics, executionHistory };
  }, [selectedWorkflow, allMetrics, recentExecutions]);

  // Handlers
  const handleTimeRangeChange = (preset: TimeRangePreset) => {
    setTimeRangePreset(preset);
    if (preset !== "custom") {
      setTimeRange(TIME_RANGES[preset]());
    }
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleExport = () => {
    const report = workflowAnalyticsService.exportAnalyticsReport(timeRange);
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-analytics-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const headers = [
      "Workflow",
      "Total Executions",
      "Success Rate",
      "Avg Duration",
      "Last Executed",
    ];
    const rows = filteredMetrics.map((m) => [
      m.workflowName,
      m.totalExecutions.toString(),
      formatPercentage(m.successRate),
      formatDuration(m.avgDuration),
      m.lastExecuted || "Never",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-metrics-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearFilters = () => {
    setFilters({
      status: "all",
      complexityLevel: "all",
    });
  };

  const hasActiveFilters =
    filters.folder ||
    filters.tag ||
    filters.status !== "all" ||
    filters.searchQuery;

  return (
    <RequireProject pageName="Workflow Analytics">
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white p-6">
        <div className="max-w-[1800px] mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/automation-builder")}
                className="border-border hover:border-primary hover:text-primary bg-transparent"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
                  Workflow Analytics
                </h1>
                <p className="text-muted-foreground">
                  Monitor execution, performance, and usage metrics
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {timeRange.start.toLocaleDateString()} -{" "}
                    {timeRange.end.toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={timeRangePreset}
                onValueChange={(v) =>
                  handleTimeRangeChange(v as TimeRangePreset)
                }
              >
                <SelectTrigger className="w-[180px] bg-muted border-border">
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 days</SelectItem>
                  <SelectItem value="month">Last 30 days</SelectItem>
                  <SelectItem value="quarter">Last 3 months</SelectItem>
                  <SelectItem value="year">Last year</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                className="border-border hover:border-primary bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleExport}
                className="border-border hover:border-primary bg-muted"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Report
              </Button>

              <Button
                variant="outline"
                onClick={handleExportCSV}
                className="border-border hover:border-green-500 bg-muted"
              >
                <FileDown className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card className="bg-muted border-border backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filters:</span>
                </div>

                <div className="flex-1 max-w-xs">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search workflows..."
                      value={filters.searchQuery || ""}
                      onChange={(e) =>
                        setFilters({ ...filters, searchQuery: e.target.value })
                      }
                      className="pl-9 bg-background border-border"
                    />
                  </div>
                </div>

                <Select
                  value={filters.status}
                  onValueChange={(v) =>
                    setFilters({
                      ...filters,
                      status: v as "success" | "failure" | "all",
                    })
                  }
                >
                  <SelectTrigger className="w-[150px] bg-background border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="success">Success Only</SelectItem>
                    <SelectItem value="failure">With Failures</SelectItem>
                  </SelectContent>
                </Select>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="text-primary hover:text-primary/80"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear Filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Overview Metrics */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              title="Total Executions"
              value={formatNumber(aggregatedStats.totalExecutions)}
              icon={<Activity className="h-4 w-4" />}
              description="All workflow runs"
              color="var(--color-brand-primary)"
            />
            <MetricCard
              title="Average Success Rate"
              value={formatPercentage(aggregatedStats.overallSuccessRate)}
              icon={<CheckCircle className="h-4 w-4" />}
              description={`${aggregatedStats.totalSuccessful} successful`}
              variant={
                aggregatedStats.overallSuccessRate > 0.9
                  ? "success"
                  : aggregatedStats.overallSuccessRate > 0.7
                    ? "warning"
                    : "error"
              }
              color="var(--color-brand-success)"
            />
            <MetricCard
              title="Average Duration"
              value={formatDuration(aggregatedStats.avgDuration)}
              icon={<Clock className="h-4 w-4" />}
              description="Average execution time"
              color="var(--color-brand-secondary)"
            />
            <MetricCard
              title="Total Errors"
              value={formatNumber(aggregatedStats.totalFailed)}
              icon={<XCircle className="h-4 w-4" />}
              description="Failed executions"
              variant={aggregatedStats.totalFailed > 10 ? "error" : "default"}
              color="#FF6B6B"
            />
            <MetricCard
              title="Most Active"
              value={
                aggregatedStats.mostActiveWorkflow?.workflowName.substring(
                  0,
                  15
                ) || "N/A"
              }
              icon={<TrendingUp className="h-4 w-4" />}
              description={
                aggregatedStats.mostActiveWorkflow
                  ? `${aggregatedStats.mostActiveWorkflow.executionCount} runs`
                  : "No data"
              }
              color="#FFD700"
            />
            <MetricCard
              title="Slowest"
              value={
                aggregatedStats.slowestWorkflow?.workflowName.substring(
                  0,
                  15
                ) || "N/A"
              }
              icon={<AlertTriangle className="h-4 w-4" />}
              description={
                aggregatedStats.slowestWorkflow
                  ? formatDuration(aggregatedStats.slowestWorkflow.avgDuration)
                  : "No data"
              }
              color="#FF6B6B"
            />
          </div>

          {/* Main Content */}
          <Tabs defaultValue="dashboard" className="space-y-6">
            <TabsList className="bg-muted border-border">
              <TabsTrigger value="dashboard">
                <BarChart3 className="h-4 w-4 mr-2" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="top-workflows">
                <TrendingUp className="h-4 w-4 mr-2" />
                Top Workflows
              </TabsTrigger>
              <TabsTrigger value="executions">
                <Activity className="h-4 w-4 mr-2" />
                Executions
              </TabsTrigger>
              <TabsTrigger value="performance">
                <Zap className="h-4 w-4 mr-2" />
                Performance
              </TabsTrigger>
              {comparisonWorkflows.length > 0 && (
                <TabsTrigger value="comparison">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Comparison ({comparisonWorkflows.length})
                </TabsTrigger>
              )}
            </TabsList>

            {/* Dashboard Tab */}
            <TabsContent value="dashboard" className="space-y-6">
              <AnalyticsDashboard
                workflows={[]}
                metrics={filteredMetrics.reduce(
                  (acc, m) => ({ ...acc, [m.workflowId]: m }),
                  {}
                )}
                executions={timeRangeExecutions}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
                onRefresh={handleRefresh}
              />
            </TabsContent>

            {/* Top Workflows Tab */}
            <TabsContent value="top-workflows" className="space-y-6">
              <Tabs defaultValue="most-executed">
                <TabsList className="bg-muted border-border">
                  <TabsTrigger value="most-executed">Most Executed</TabsTrigger>
                  <TabsTrigger value="slowest">Slowest</TabsTrigger>
                  <TabsTrigger value="highest-error">
                    Highest Error Rate
                  </TabsTrigger>
                  <TabsTrigger value="recently-failed">
                    Recently Failed
                  </TabsTrigger>
                </TabsList>

                {/* Most Executed */}
                <TabsContent value="most-executed">
                  <Card className="bg-muted border-border">
                    <CardHeader>
                      <CardTitle>Most Executed Workflows</CardTitle>
                      <CardDescription>
                        Top 10 workflows by execution count
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {topWorkflows.mostExecuted.map((metric, index) => (
                          <div
                            key={metric.workflowId}
                            className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-border transition-colors cursor-pointer"
                            onClick={() =>
                              setSelectedWorkflow(metric.workflowId)
                            }
                          >
                            <div className="flex items-center gap-4 flex-1">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-bold">
                                {index + 1}
                              </div>
                              <div className="flex-1">
                                <p className="font-medium">
                                  {metric.workflowName}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    {formatPercentage(metric.successRate)}{" "}
                                    success rate
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-primary">
                                {formatNumber(metric.totalExecutions)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                executions
                              </p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground ml-4" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Slowest */}
                <TabsContent value="slowest">
                  <Card className="bg-muted border-border">
                    <CardHeader>
                      <CardTitle>Slowest Workflows</CardTitle>
                      <CardDescription>
                        Top 10 workflows by average duration
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {topWorkflows.slowest.map((metric, index) => (
                          <div
                            key={metric.workflowId}
                            className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-border transition-colors cursor-pointer"
                            onClick={() =>
                              setSelectedWorkflow(metric.workflowId)
                            }
                          >
                            <div className="flex items-center gap-4 flex-1">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-secondary/20 text-brand-secondary font-bold">
                                {index + 1}
                              </div>
                              <div className="flex-1">
                                <p className="font-medium">
                                  {metric.workflowName}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    Min: {formatDuration(metric.minDuration)}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    Max: {formatDuration(metric.maxDuration)}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-brand-secondary">
                                {formatDuration(metric.avgDuration)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                avg duration
                              </p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground ml-4" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Highest Error Rate */}
                <TabsContent value="highest-error">
                  <Card className="bg-muted border-border">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        Highest Error Rate
                      </CardTitle>
                      <CardDescription>
                        Workflows with the most failures
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {topWorkflows.highestError.length > 0 ? (
                        <div className="space-y-3">
                          {topWorkflows.highestError.map((metric, index) => (
                            <div
                              key={metric.workflowId}
                              className="flex items-center justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5 hover:border-red-500/30 transition-colors cursor-pointer"
                              onClick={() =>
                                setSelectedWorkflow(metric.workflowId)
                              }
                            >
                              <div className="flex items-center gap-4 flex-1">
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/20 text-red-500 font-bold">
                                  {index + 1}
                                </div>
                                <div className="flex-1">
                                  <p className="font-medium">
                                    {metric.workflowName}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {metric.failedExecutions} failures
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {metric.totalExecutions} total runs
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-2xl font-bold text-red-500">
                                  {formatPercentage(1 - metric.successRate)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  error rate
                                </p>
                              </div>
                              <ChevronRight className="h-5 w-5 text-muted-foreground ml-4" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                          <h3 className="text-lg font-semibold mb-2">
                            No Failures Detected
                          </h3>
                          <p className="text-muted-foreground">
                            All workflows are running successfully!
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Recently Failed */}
                <TabsContent value="recently-failed">
                  <Card className="bg-muted border-border">
                    <CardHeader>
                      <CardTitle>Recently Failed Executions</CardTitle>
                      <CardDescription>
                        Most recent workflow failures
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {topWorkflows.recentlyFailed.length > 0 ? (
                        <div className="space-y-3">
                          {topWorkflows.recentlyFailed.map((execution) => (
                            <div
                              key={execution.id}
                              className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 hover:border-red-500/30 transition-colors cursor-pointer"
                              onClick={() => setSelectedExecution(execution)}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <p className="font-medium">
                                    {execution.workflowName}
                                  </p>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {new Date(
                                      execution.startTime
                                    ).toLocaleString()}
                                  </p>
                                </div>
                                <Badge variant="destructive">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Failed
                                </Badge>
                              </div>
                              {execution.error && (
                                <Alert className="mt-2 bg-red-500/10 border-red-500/20">
                                  <AlertCircle className="h-4 w-4" />
                                  <AlertTitle className="text-sm">
                                    Error
                                  </AlertTitle>
                                  <AlertDescription className="text-xs">
                                    {execution.error}
                                  </AlertDescription>
                                </Alert>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                          <h3 className="text-lg font-semibold mb-2">
                            No Recent Failures
                          </h3>
                          <p className="text-muted-foreground">
                            All recent executions were successful!
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* Executions Tab */}
            <TabsContent value="executions">
              <Card className="bg-muted border-border">
                <CardHeader>
                  <CardTitle>Execution Log</CardTitle>
                  <CardDescription>
                    Recent workflow executions with detailed information
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ExecutionTable
                    executions={recentExecutions}
                    onRowClick={(execution) => setSelectedExecution(execution)}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Performance Tab */}
            <TabsContent value="performance" className="space-y-6">
              {selectedWorkflow && selectedWorkflowData ? (
                <>
                  <WorkflowMetricsPanel
                    workflow={selectedWorkflowData.workflow}
                    metrics={selectedWorkflowData.metrics}
                    complexityMetrics={selectedWorkflowData.complexityMetrics}
                    executionHistory={selectedWorkflowData.executionHistory}
                  />
                  <PerformanceAnalyzer
                    workflow={selectedWorkflowData.workflow}
                    onAnalyze={() => {}}
                    onApplySuggestion={() => {}}
                  />
                </>
              ) : (
                <Card className="bg-muted border-border">
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <Info className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold mb-2">
                      Select a Workflow
                    </h3>
                    <p className="text-muted-foreground text-center mb-6">
                      Choose a workflow from the Top Workflows tab to view
                      detailed performance analysis
                    </p>
                    <Button
                      onClick={() => {
                        const firstWorkflow = topWorkflows.mostExecuted[0];
                        if (firstWorkflow) {
                          setSelectedWorkflow(firstWorkflow.workflowId);
                        }
                      }}
                      disabled={topWorkflows.mostExecuted.length === 0}
                    >
                      View Top Workflow
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Comparison Tab */}
            {comparisonWorkflows.length > 0 && (
              <TabsContent value="comparison">
                <Card className="bg-muted border-border">
                  <CardHeader>
                    <CardTitle>Workflow Comparison</CardTitle>
                    <CardDescription>
                      Comparing {comparisonWorkflows.length} workflow
                      {comparisonWorkflows.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Alert className="mb-6">
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        This feature is coming soon! You&apos;ll be able to
                        compare execution counts, durations, success rates, and
                        complexity side-by-side.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>

          {/* Execution Details Modal Placeholder */}
          {selectedExecution && (
            <Alert className="fixed bottom-4 right-4 w-96 bg-muted border-border">
              <Activity className="h-4 w-4" />
              <AlertTitle className="flex items-center justify-between">
                Execution Details
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedExecution(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </AlertTitle>
              <AlertDescription>
                <div className="space-y-2 mt-2">
                  <p className="text-sm font-medium">
                    {selectedExecution.workflowName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(selectedExecution.startTime).toLocaleString()}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        selectedExecution.success ? "default" : "destructive"
                      }
                    >
                      {selectedExecution.success ? "Success" : "Failed"}
                    </Badge>
                    <Badge variant="outline">
                      {formatDuration(selectedExecution.duration)}
                    </Badge>
                  </div>
                  {selectedExecution.error && (
                    <div className="mt-2 p-2 rounded bg-red-500/10 text-xs">
                      {selectedExecution.error}
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </RequireProject>
  );
}
