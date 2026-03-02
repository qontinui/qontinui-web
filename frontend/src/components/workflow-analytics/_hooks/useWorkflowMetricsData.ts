import { useMemo } from "react";
import { WorkflowMetrics } from "@/services/workflow-analytics-service";
import { ComplexityAnalysis } from "@/services/workflow-complexity-analyzer";
import { TestResult } from "@/services/workflow-testing-service";
import { CHART_COLORS } from "../workflow-metrics-panel-utils";
import { formatRelativeTime } from "../workflow-metrics-panel-utils";
import type {
  TimelineDataPoint,
  BreakdownDataPoint,
  PerformanceTrendDataPoint,
  SuccessRateTrendDataPoint,
  ComplexityTableRow,
} from "../workflow-metrics-panel-types";

export function useWorkflowMetricsData(
  metrics: WorkflowMetrics,
  complexityMetrics: ComplexityAnalysis,
  executionHistory: TestResult[]
) {
  const avgMetrics = useMemo(() => {
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

  const timelineData = useMemo<TimelineDataPoint[]>(() => {
    return executionHistory.slice(-30).map((result, index) => ({
      index: index + 1,
      duration: result.duration,
      success: result.passed ? 1 : 0,
      failed: result.passed ? 0 : 1,
      timestamp: new Date(result.startTime).toLocaleString(),
    }));
  }, [executionHistory]);

  const breakdownData = useMemo<BreakdownDataPoint[]>(() => {
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

  const performanceTrendData = useMemo<PerformanceTrendDataPoint[]>(() => {
    return executionHistory.slice(-20).map((result, index) => ({
      run: `#${executionHistory.length - 20 + index + 1}`,
      duration: result.duration,
      avgDuration: metrics.avgDuration,
      timestamp: formatRelativeTime(result.startTime),
    }));
  }, [executionHistory, metrics.avgDuration]);

  const successRateTrendData = useMemo<SuccessRateTrendDataPoint[]>(() => {
    const chunkSize = 5;
    const chunks: SuccessRateTrendDataPoint[] = [];

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

    return chunks.slice(-10);
  }, [executionHistory]);

  const complexityTableData = useMemo<ComplexityTableRow[]>(() => {
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

  const recentRuns = useMemo(() => {
    return executionHistory.slice(-10).reverse();
  }, [executionHistory]);

  return {
    successRateTrend,
    durationTrend,
    timelineData,
    breakdownData,
    performanceTrendData,
    successRateTrendData,
    complexityTableData,
    recentRuns,
  };
}
