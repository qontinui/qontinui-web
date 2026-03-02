"use client";

import React from "react";
import { Activity, CheckCircle, Clock, Calendar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useWorkflowMetricsData } from "./_hooks/useWorkflowMetricsData";
import { WorkflowMetricCard } from "./_components/WorkflowMetricCard";
import { ComplexityTab } from "./_components/ComplexityTab";
import { ExecutionHistoryTab } from "./_components/ExecutionHistoryTab";
import { PerformanceTrendsTab } from "./_components/PerformanceTrendsTab";
import { MetricsBreakdownTab } from "./_components/MetricsBreakdownTab";
import {
  formatDuration,
  formatPercentage,
  formatRelativeTime,
} from "./workflow-metrics-panel-utils";
import type { WorkflowMetricsPanelProps } from "./workflow-metrics-panel-types";

export type { WorkflowMetricsPanelProps } from "./workflow-metrics-panel-types";

export function WorkflowMetricsPanel({
  workflow,
  metrics,
  complexityMetrics,
  executionHistory,
  className,
}: WorkflowMetricsPanelProps) {
  const {
    successRateTrend,
    durationTrend,
    timelineData,
    breakdownData,
    performanceTrendData,
    successRateTrendData,
    complexityTableData,
    recentRuns,
  } = useWorkflowMetricsData(metrics, complexityMetrics, executionHistory);

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
        <WorkflowMetricCard
          title="Total Runs"
          value={metrics.totalExecutions}
          icon={<Activity className="h-4 w-4" />}
          subtitle="All executions"
        />
        <WorkflowMetricCard
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
        <WorkflowMetricCard
          title="Avg Duration"
          value={formatDuration(metrics.avgDuration)}
          icon={<Clock className="h-4 w-4" />}
          trend={-durationTrend}
          subtitle={`Min: ${formatDuration(metrics.minDuration)} / Max: ${formatDuration(metrics.maxDuration)}`}
        />
        <WorkflowMetricCard
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

        <TabsContent value="complexity" className="space-y-4">
          <ComplexityTab
            complexityMetrics={complexityMetrics}
            complexityTableData={complexityTableData}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <ExecutionHistoryTab
            timelineData={timelineData}
            recentRuns={recentRuns}
            executionHistoryLength={executionHistory.length}
          />
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <PerformanceTrendsTab
            performanceTrendData={performanceTrendData}
            successRateTrendData={successRateTrendData}
          />
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-4">
          <MetricsBreakdownTab
            metrics={metrics}
            breakdownData={breakdownData}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default WorkflowMetricsPanel;
