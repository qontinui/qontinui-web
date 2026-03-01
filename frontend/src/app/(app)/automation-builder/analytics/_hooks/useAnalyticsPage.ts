import { useState, useMemo } from "react";
import { workflowAnalyticsService } from "@/services/workflow-analytics-service";
import {
  TIME_RANGES,
  formatDuration,
  formatPercentage,
  getComplexityLevel,
} from "../analytics-utils";
import type {
  TimeRangePreset,
  FilterState,
  TopWorkflows,
  SelectedWorkflowData,
  ExecutionRecord,
  AggregatedStats,
  WorkflowMetrics,
} from "../analytics-types";

export function useAnalyticsPage() {
  const [timeRange, setTimeRange] = useState<{ start: Date; end: Date }>(() =>
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

  const allMetrics: WorkflowMetrics[] = useMemo(
    () => workflowAnalyticsService.getAllMetrics(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey]
  );

  const aggregatedStats: AggregatedStats = useMemo(
    () => workflowAnalyticsService.getAggregatedStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey]
  );

  const recentExecutions: ExecutionRecord[] = useMemo(
    () => workflowAnalyticsService.getRecentExecutions(100),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey]
  );

  const timeRangeExecutions: ExecutionRecord[] = useMemo(
    () =>
      workflowAnalyticsService.getExecutionsInDateRange(
        timeRange.start,
        timeRange.end
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey triggers refresh
    [refreshKey, timeRange]
  );

  const filteredMetrics: WorkflowMetrics[] = useMemo(() => {
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

  const topWorkflows: TopWorkflows = useMemo(
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

  const selectedWorkflowData: SelectedWorkflowData | null = useMemo(() => {
    if (!selectedWorkflow) return null;
    const metrics = allMetrics.find((m) => m.workflowId === selectedWorkflow);
    if (!metrics) return null;

    const workflow = {
      id: selectedWorkflow,
      name: metrics.workflowName,
      description: "",
      version: "1.0.0",
      format: "graph" as const,
      actions: [],
      connections: {},
      metadata: {},
    };

    const complexityMetrics = {
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

    const executionHistory = recentExecutions
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

  return {
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
  };
}
