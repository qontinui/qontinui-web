import { useState, useMemo, useCallback } from "react";
import {
  WorkflowMetrics,
  ExecutionRecord,
} from "@/services/workflow-analytics-service";
import { TIME_RANGES } from "../analytics-dashboard-utils";
import type {
  AggregatedMetrics,
  TopWorkflows,
  TimelineDataPoint,
  SuccessRateDataPoint,
  DurationDataPoint,
} from "../analytics-dashboard-types";

const DEFAULT_EXECUTIONS: ExecutionRecord[] = [];

export function useAnalyticsDashboard(
  metrics: Record<string, WorkflowMetrics>,
  executions: ExecutionRecord[] = DEFAULT_EXECUTIONS,
  timeRange: { start: Date; end: Date },
  onTimeRangeChange: (range: { start: Date; end: Date }) => void
) {
  const [selectedFolder, setSelectedFolder] = useState<string>("all");
  const [customDateDialogOpen, setCustomDateDialogOpen] = useState(false);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const aggregatedMetrics = useMemo((): AggregatedMetrics => {
    const metricsArray = Object.values(metrics);

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

  const topWorkflows = useMemo((): TopWorkflows => {
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

  const timelineData = useMemo((): TimelineDataPoint[] => {
    const executionsByDate: Record<
      string,
      { executions: number; success: number; failed: number }
    > = {};

    const daysDiff = Math.ceil(
      (timeRange.end.getTime() - timeRange.start.getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const points = Math.min(daysDiff, 30);

    for (let i = 0; i < points; i++) {
      const date = new Date(
        timeRange.start.getTime() +
          (i * (timeRange.end.getTime() - timeRange.start.getTime())) / points
      );
      const dateKey = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      executionsByDate[dateKey] = { executions: 0, success: 0, failed: 0 };
    }

    executions.forEach((exec) => {
      const execDate = new Date(exec.startTime);
      if (execDate >= timeRange.start && execDate <= timeRange.end) {
        const dateKey = execDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const bucketDate = Object.keys(executionsByDate).find((key) => {
          return key === dateKey;
        });
        if (bucketDate && executionsByDate[bucketDate]) {
          executionsByDate[bucketDate].executions++;
          if (exec.success) {
            executionsByDate[bucketDate].success++;
          } else {
            executionsByDate[bucketDate].failed++;
          }
        } else {
          const execDateNum = execDate.getTime();
          let nearestKey: string | null = null;
          let nearestDiff = Infinity;
          for (let i = 0; i < points; i++) {
            const bucketDateObj = new Date(
              timeRange.start.getTime() +
                (i * (timeRange.end.getTime() - timeRange.start.getTime())) /
                  points
            );
            const diff = Math.abs(bucketDateObj.getTime() - execDateNum);
            if (diff < nearestDiff) {
              nearestDiff = diff;
              nearestKey = bucketDateObj.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
            }
          }
          if (nearestKey) {
            const bucket = executionsByDate[nearestKey];
            if (bucket) {
              bucket.executions++;
              if (exec.success) {
                bucket.success++;
              } else {
                bucket.failed++;
              }
            }
          }
        }
      }
    });

    const data: TimelineDataPoint[] = [];

    for (let i = 0; i < points; i++) {
      const date = new Date(
        timeRange.start.getTime() +
          (i * (timeRange.end.getTime() - timeRange.start.getTime())) / points
      );
      const dateKey = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const bucket = executionsByDate[dateKey] || {
        executions: 0,
        success: 0,
        failed: 0,
      };
      data.push({
        name: dateKey,
        executions: bucket.executions,
        success: bucket.success,
        failed: bucket.failed,
      });
    }

    return data;
  }, [timeRange, executions]);

  const successRateData = useMemo((): SuccessRateDataPoint[] => {
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

  const durationData = useMemo((): DurationDataPoint[] => {
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

  const handleTimeRangeChange = useCallback(
    (preset: string) => {
      if (preset === "custom") {
        const startDateStr = timeRange.start.toISOString().split("T")[0] ?? "";
        const endDateStr = timeRange.end.toISOString().split("T")[0] ?? "";
        setCustomStartDate(startDateStr);
        setCustomEndDate(endDateStr);
        setCustomDateDialogOpen(true);
        return;
      }

      const rangeFunc = TIME_RANGES[preset as keyof typeof TIME_RANGES];
      if (rangeFunc) {
        onTimeRangeChange(rangeFunc());
      }
    },
    [timeRange, onTimeRangeChange]
  );

  const handleApplyCustomDateRange = useCallback(() => {
    if (!customStartDate || !customEndDate) return;

    const start = new Date(customStartDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(customEndDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      onTimeRangeChange({ start: end, end: start });
    } else {
      onTimeRangeChange({ start, end });
    }

    setCustomDateDialogOpen(false);
  }, [customStartDate, customEndDate, onTimeRangeChange]);

  const handleExport = useCallback(() => {
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
  }, [timeRange, aggregatedMetrics, metrics]);

  return {
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
  };
}
