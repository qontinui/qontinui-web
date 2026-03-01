"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RequireProject } from "@/components/require-project";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  TrendingUp,
  Filter,
  X,
  BarChart3,
  FileDown,
  Search,
  Zap,
  ArrowLeft,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  formatDuration,
  formatPercentage,
  formatNumber,
} from "./analytics-utils";
import type { TimeRangePreset } from "./analytics-types";
import { useAnalyticsPage } from "./_hooks/useAnalyticsPage";
import { MetricCard } from "./_components/MetricCard";
import { ExecutionTable } from "./_components/ExecutionTable";
import { TopWorkflowsTab } from "./_components/TopWorkflowsTab";
import { PerformanceTab } from "./_components/PerformanceTab";
import { ExecutionDetailsAlert } from "./_components/ExecutionDetailsAlert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

const AnalyticsDashboard = dynamic(
  () =>
    import("@/components/workflow-analytics/AnalyticsDashboard").then((m) => ({
      default: m.AnalyticsDashboard,
    })),
  { ssr: false }
);

export default function WorkflowAnalyticsPage() {
  const router = useRouter();
  const {
    timeRange,
    setTimeRange,
    timeRangePreset,
    filters,
    setFilters,
    selectedWorkflow,
    setSelectedWorkflow,
    comparisonWorkflows,
    selectedExecution,
    setSelectedExecution,
    aggregatedStats,
    recentExecutions,
    timeRangeExecutions,
    filteredMetrics,
    topWorkflows,
    selectedWorkflowData,
    handleTimeRangeChange,
    handleRefresh,
    handleExport,
    handleExportCSV,
    handleClearFilters,
    hasActiveFilters,
  } = useAnalyticsPage();

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
              <TopWorkflowsTab
                topWorkflows={topWorkflows}
                onSelectWorkflow={setSelectedWorkflow}
                onSelectExecution={setSelectedExecution}
              />
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
              <PerformanceTab
                selectedWorkflow={selectedWorkflow}
                selectedWorkflowData={selectedWorkflowData}
                topWorkflows={topWorkflows}
                onSelectWorkflow={setSelectedWorkflow}
              />
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

          {selectedExecution && (
            <ExecutionDetailsAlert
              execution={selectedExecution}
              onClose={() => setSelectedExecution(null)}
            />
          )}
        </div>
      </div>
    </RequireProject>
  );
}
