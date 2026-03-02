"use client";

import React from "react";
import {
  Activity,
  CheckCircle,
  Clock,
  Workflow as WorkflowIcon,
  Filter,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatNumber,
  formatPercentage,
  formatDuration,
} from "./analytics-dashboard-utils";
import { useAnalyticsDashboard } from "./_hooks/useAnalyticsDashboard";
import { MetricCard } from "@/components/common/_components/MetricCard";
import { DashboardHeader } from "./_components/DashboardHeader";
import { ChartTabs } from "./_components/ChartTabs";
import { TopWorkflowsTables } from "./_components/TopWorkflowsTables";
import { CustomDateRangeDialog } from "./_components/CustomDateRangeDialog";

export type { AnalyticsDashboardProps } from "./analytics-dashboard-types";

import type { AnalyticsDashboardProps } from "./analytics-dashboard-types";

const DEFAULT_EXECUTIONS: import("@/services/workflow-analytics-service").ExecutionRecord[] =
  [];

export function AnalyticsDashboard({
  workflows,
  metrics,
  executions = DEFAULT_EXECUTIONS,
  timeRange,
  onTimeRangeChange,
  onRefresh,
  className,
}: AnalyticsDashboardProps) {
  const {
    selectedFolder,
    setSelectedFolder,
    customDateDialogOpen,
    setCustomDateDialogOpen,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
    aggregatedMetrics,
    topWorkflows,
    timelineData,
    successRateData,
    durationData,
    handleTimeRangeChange,
    handleApplyCustomDateRange,
    handleExport,
  } = useAnalyticsDashboard(metrics, executions, timeRange, onTimeRangeChange);

  return (
    <div className={cn("space-y-6", className)}>
      <DashboardHeader
        onTimeRangeChange={handleTimeRangeChange}
        onRefresh={onRefresh}
        onExport={handleExport}
      />

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

      <ChartTabs
        timelineData={timelineData}
        successRateData={successRateData}
        durationData={durationData}
        mostExecuted={topWorkflows.mostExecuted}
      />

      <TopWorkflowsTables topWorkflows={topWorkflows} />

      <CustomDateRangeDialog
        open={customDateDialogOpen}
        onOpenChange={setCustomDateDialogOpen}
        startDate={customStartDate}
        endDate={customEndDate}
        onStartDateChange={setCustomStartDate}
        onEndDateChange={setCustomEndDate}
        onApply={handleApplyCustomDateRange}
      />
    </div>
  );
}

export default AnalyticsDashboard;
