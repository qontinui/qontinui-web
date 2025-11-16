/**
 * Workflow Analytics Service
 *
 * Comprehensive analytics and metrics tracking for workflow monitoring.
 * Tracks execution history, calculates statistics, and provides insights.
 *
 * Storage:
 * - 'workflow-metrics': Aggregated metrics per workflow
 * - 'workflow-executions': Detailed execution records
 */

import { Workflow } from '@/lib/action-schema/action-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Single workflow execution record
 */
export interface ExecutionRecord {
  /** Unique execution ID */
  id: string;

  /** Workflow ID that was executed */
  workflowId: string;

  /** Workflow name at time of execution */
  workflowName: string;

  /** Execution start timestamp */
  startTime: string;

  /** Execution end timestamp */
  endTime: string;

  /** Duration in milliseconds */
  duration: number;

  /** Whether execution succeeded */
  success: boolean;

  /** Error message if execution failed */
  error?: string;

  /** Folder ID if workflow is organized in folders */
  folderId?: string;
}

/**
 * Aggregated metrics for a workflow
 */
export interface WorkflowMetrics {
  /** Workflow ID */
  workflowId: string;

  /** Workflow name */
  workflowName: string;

  /** Total number of executions */
  totalExecutions: number;

  /** Number of successful executions */
  successfulExecutions: number;

  /** Number of failed executions */
  failedExecutions: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Average execution duration in milliseconds */
  avgDuration: number;

  /** Minimum execution duration in milliseconds */
  minDuration: number;

  /** Maximum execution duration in milliseconds */
  maxDuration: number;

  /** Timestamp of last execution */
  lastExecuted?: string;

  /** Timestamp of first execution */
  firstExecuted?: string;

  /** Folder ID if organized */
  folderId?: string;
}

/**
 * Time series data point for execution timeline
 */
export interface TimelineDataPoint {
  /** Timestamp */
  timestamp: string;

  /** Duration in milliseconds */
  duration: number;

  /** Success status */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Aggregated project-wide statistics
 */
export interface AggregatedStats {
  /** Total number of unique workflows */
  totalWorkflows: number;

  /** Total executions across all workflows */
  totalExecutions: number;

  /** Total successful executions */
  totalSuccessful: number;

  /** Total failed executions */
  totalFailed: number;

  /** Overall success rate (0-1) */
  overallSuccessRate: number;

  /** Average duration across all executions */
  avgDuration: number;

  /** Most active workflow (by execution count) */
  mostActiveWorkflow?: {
    workflowId: string;
    workflowName: string;
    executionCount: number;
  };

  /** Slowest workflow (by average duration) */
  slowestWorkflow?: {
    workflowId: string;
    workflowName: string;
    avgDuration: number;
  };

  /** Workflow with highest error rate */
  mostErrorProneWorkflow?: {
    workflowId: string;
    workflowName: string;
    errorRate: number;
  };
}

/**
 * Analytics report export data
 */
export interface AnalyticsReport {
  /** Report generation timestamp */
  generatedAt: string;

  /** Time range covered by report */
  timeRange: {
    start: string;
    end: string;
  };

  /** Aggregated statistics */
  stats: AggregatedStats;

  /** Per-workflow metrics */
  workflowMetrics: WorkflowMetrics[];

  /** Recent execution history */
  recentExecutions: ExecutionRecord[];
}

/**
 * Time range filter options
 */
export interface TimeRange {
  /** Start date/time */
  start: Date | string;

  /** End date/time */
  end: Date | string;
}

// ============================================================================
// Storage Keys
// ============================================================================

const METRICS_STORAGE_KEY = 'workflow-metrics';
const EXECUTIONS_STORAGE_KEY = 'workflow-executions';

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Get all execution records from storage
 */
function getExecutions(): ExecutionRecord[] {
  try {
    const data = localStorage.getItem(EXECUTIONS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to load execution records:', error);
    return [];
  }
}

/**
 * Save execution records to storage
 */
function saveExecutions(executions: ExecutionRecord[]): void {
  try {
    localStorage.setItem(EXECUTIONS_STORAGE_KEY, JSON.stringify(executions));
  } catch (error) {
    console.error('Failed to save execution records:', error);
  }
}

/**
 * Get all workflow metrics from storage
 */
function getMetricsMap(): Record<string, WorkflowMetrics> {
  try {
    const data = localStorage.getItem(METRICS_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Failed to load workflow metrics:', error);
    return {};
  }
}

/**
 * Save workflow metrics to storage
 */
function saveMetricsMap(metrics: Record<string, WorkflowMetrics>): void {
  try {
    localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(metrics));
  } catch (error) {
    console.error('Failed to save workflow metrics:', error);
  }
}

// ============================================================================
// Metric Calculation
// ============================================================================

/**
 * Calculate metrics for a workflow from execution records
 */
function calculateMetrics(
  workflowId: string,
  workflowName: string,
  executions: ExecutionRecord[],
  folderId?: string
): WorkflowMetrics {
  const workflowExecutions = executions.filter((e) => e.workflowId === workflowId);

  if (workflowExecutions.length === 0) {
    return {
      workflowId,
      workflowName,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      successRate: 0,
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      folderId,
    };
  }

  const successfulExecutions = workflowExecutions.filter((e) => e.success).length;
  const failedExecutions = workflowExecutions.length - successfulExecutions;
  const durations = workflowExecutions.map((e) => e.duration);

  return {
    workflowId,
    workflowName,
    totalExecutions: workflowExecutions.length,
    successfulExecutions,
    failedExecutions,
    successRate: successfulExecutions / workflowExecutions.length,
    avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
    minDuration: Math.min(...durations),
    maxDuration: Math.max(...durations),
    lastExecuted: workflowExecutions[workflowExecutions.length - 1]?.endTime,
    firstExecuted: workflowExecutions[0]?.startTime,
    folderId,
  };
}

/**
 * Filter executions by time range
 */
function filterByTimeRange(executions: ExecutionRecord[], timeRange?: TimeRange): ExecutionRecord[] {
  if (!timeRange) return executions;

  const startTime = new Date(timeRange.start).getTime();
  const endTime = new Date(timeRange.end).getTime();

  return executions.filter((e) => {
    const execTime = new Date(e.startTime).getTime();
    return execTime >= startTime && execTime <= endTime;
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Track a workflow execution
 */
export function trackExecution(
  workflowId: string,
  workflowName: string,
  duration: number,
  success: boolean,
  error?: string,
  folderId?: string
): void {
  const now = new Date().toISOString();
  const startTime = new Date(Date.now() - duration).toISOString();

  const execution: ExecutionRecord = {
    id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    workflowId,
    workflowName,
    startTime,
    endTime: now,
    duration,
    success,
    error,
    folderId,
  };

  // Add to executions
  const executions = getExecutions();
  executions.push(execution);
  saveExecutions(executions);

  // Update metrics
  const metricsMap = getMetricsMap();
  metricsMap[workflowId] = calculateMetrics(workflowId, workflowName, executions, folderId);
  saveMetricsMap(metricsMap);
}

/**
 * Get metrics for a specific workflow
 */
export function getWorkflowMetrics(workflowId: string): WorkflowMetrics | null {
  const metricsMap = getMetricsMap();
  return metricsMap[workflowId] || null;
}

/**
 * Get metrics for all workflows
 */
export function getAllMetrics(): WorkflowMetrics[] {
  const metricsMap = getMetricsMap();
  return Object.values(metricsMap);
}

/**
 * Get metrics for workflows in a specific date range
 */
export function getMetricsInDateRange(startDate: Date | string, endDate: Date | string): WorkflowMetrics[] {
  const executions = getExecutions();
  const filteredExecutions = filterByTimeRange(executions, { start: startDate, end: endDate });

  // Group by workflow and calculate metrics
  const workflowGroups: Record<string, ExecutionRecord[]> = {};
  filteredExecutions.forEach((exec) => {
    if (!workflowGroups[exec.workflowId]) {
      workflowGroups[exec.workflowId] = [];
    }
    workflowGroups[exec.workflowId].push(exec);
  });

  return Object.entries(workflowGroups).map(([workflowId, execs]) =>
    calculateMetrics(workflowId, execs[0].workflowName, execs, execs[0].folderId)
  );
}

/**
 * Get metrics for workflows in a specific folder
 */
export function getMetricsByFolder(folderId: string): WorkflowMetrics[] {
  const allMetrics = getAllMetrics();
  return allMetrics.filter((m) => m.folderId === folderId);
}

/**
 * Get most frequently executed workflows
 */
export function getMostUsedWorkflows(limit: number = 10): WorkflowMetrics[] {
  const allMetrics = getAllMetrics();
  return allMetrics
    .sort((a, b) => b.totalExecutions - a.totalExecutions)
    .slice(0, limit);
}

/**
 * Get workflows with slowest average execution time
 */
export function getSlowestWorkflows(limit: number = 10): WorkflowMetrics[] {
  const allMetrics = getAllMetrics();
  return allMetrics
    .filter((m) => m.totalExecutions > 0)
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, limit);
}

/**
 * Get workflows with highest error rates
 */
export function getHighestErrorRateWorkflows(limit: number = 10): WorkflowMetrics[] {
  const allMetrics = getAllMetrics();
  return allMetrics
    .filter((m) => m.totalExecutions > 0 && m.failedExecutions > 0)
    .sort((a, b) => (1 - b.successRate) - (1 - a.successRate))
    .slice(0, limit);
}

/**
 * Get recent execution records
 */
export function getRecentExecutions(limit: number = 50): ExecutionRecord[] {
  const executions = getExecutions();
  return executions.slice(-limit).reverse(); // Most recent first
}

/**
 * Calculate success rate for a workflow
 */
export function calculateSuccessRate(workflowId: string, timeRange?: TimeRange): number {
  const executions = getExecutions();
  let workflowExecutions = executions.filter((e) => e.workflowId === workflowId);

  if (timeRange) {
    workflowExecutions = filterByTimeRange(workflowExecutions, timeRange);
  }

  if (workflowExecutions.length === 0) return 0;

  const successful = workflowExecutions.filter((e) => e.success).length;
  return successful / workflowExecutions.length;
}

/**
 * Calculate average execution duration for a workflow
 */
export function calculateAvgDuration(workflowId: string, timeRange?: TimeRange): number {
  const executions = getExecutions();
  let workflowExecutions = executions.filter((e) => e.workflowId === workflowId);

  if (timeRange) {
    workflowExecutions = filterByTimeRange(workflowExecutions, timeRange);
  }

  if (workflowExecutions.length === 0) return 0;

  const totalDuration = workflowExecutions.reduce((sum, e) => sum + e.duration, 0);
  return totalDuration / workflowExecutions.length;
}

/**
 * Get execution timeline (time series data) for a workflow
 */
export function getExecutionTimeline(workflowId: string): TimelineDataPoint[] {
  const executions = getExecutions();
  const workflowExecutions = executions.filter((e) => e.workflowId === workflowId);

  return workflowExecutions.map((e) => ({
    timestamp: e.endTime,
    duration: e.duration,
    success: e.success,
    error: e.error,
  }));
}

/**
 * Get aggregated project-wide statistics
 */
export function getAggregatedStats(): AggregatedStats {
  const allMetrics = getAllMetrics();
  const executions = getExecutions();

  if (allMetrics.length === 0) {
    return {
      totalWorkflows: 0,
      totalExecutions: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      overallSuccessRate: 0,
      avgDuration: 0,
    };
  }

  const totalExecutions = allMetrics.reduce((sum, m) => sum + m.totalExecutions, 0);
  const totalSuccessful = allMetrics.reduce((sum, m) => sum + m.successfulExecutions, 0);
  const totalFailed = allMetrics.reduce((sum, m) => sum + m.failedExecutions, 0);

  const totalDuration = executions.reduce((sum, e) => sum + e.duration, 0);

  // Most active workflow
  const mostActive = allMetrics.reduce((max, m) =>
    m.totalExecutions > (max?.totalExecutions || 0) ? m : max
  );

  // Slowest workflow
  const slowest = allMetrics
    .filter((m) => m.totalExecutions > 0)
    .reduce((max, m) => (m.avgDuration > (max?.avgDuration || 0) ? m : max));

  // Most error-prone workflow
  const mostErrorProne = allMetrics
    .filter((m) => m.totalExecutions > 0 && m.failedExecutions > 0)
    .reduce((max, m) => ((1 - m.successRate) > (1 - (max?.successRate || 1)) ? m : max));

  return {
    totalWorkflows: allMetrics.length,
    totalExecutions,
    totalSuccessful,
    totalFailed,
    overallSuccessRate: totalExecutions > 0 ? totalSuccessful / totalExecutions : 0,
    avgDuration: executions.length > 0 ? totalDuration / executions.length : 0,
    mostActiveWorkflow: mostActive
      ? {
          workflowId: mostActive.workflowId,
          workflowName: mostActive.workflowName,
          executionCount: mostActive.totalExecutions,
        }
      : undefined,
    slowestWorkflow: slowest
      ? {
          workflowId: slowest.workflowId,
          workflowName: slowest.workflowName,
          avgDuration: slowest.avgDuration,
        }
      : undefined,
    mostErrorProneWorkflow: mostErrorProne
      ? {
          workflowId: mostErrorProne.workflowId,
          workflowName: mostErrorProne.workflowName,
          errorRate: 1 - mostErrorProne.successRate,
        }
      : undefined,
  };
}

/**
 * Export analytics report for a time range
 */
export function exportAnalyticsReport(timeRange?: TimeRange): AnalyticsReport {
  const executions = getExecutions();
  const filteredExecutions = timeRange ? filterByTimeRange(executions, timeRange) : executions;

  const start = timeRange?.start || (executions[0]?.startTime || new Date().toISOString());
  const end = timeRange?.end || new Date().toISOString();

  // Calculate metrics for filtered executions
  const workflowGroups: Record<string, ExecutionRecord[]> = {};
  filteredExecutions.forEach((exec) => {
    if (!workflowGroups[exec.workflowId]) {
      workflowGroups[exec.workflowId] = [];
    }
    workflowGroups[exec.workflowId].push(exec);
  });

  const workflowMetrics = Object.entries(workflowGroups).map(([workflowId, execs]) =>
    calculateMetrics(workflowId, execs[0].workflowName, execs, execs[0].folderId)
  );

  // Calculate aggregated stats
  const totalExecutions = workflowMetrics.reduce((sum, m) => sum + m.totalExecutions, 0);
  const totalSuccessful = workflowMetrics.reduce((sum, m) => sum + m.successfulExecutions, 0);
  const totalFailed = workflowMetrics.reduce((sum, m) => sum + m.failedExecutions, 0);
  const totalDuration = filteredExecutions.reduce((sum, e) => sum + e.duration, 0);

  const mostActive = workflowMetrics.reduce((max, m) =>
    m.totalExecutions > (max?.totalExecutions || 0) ? m : max
  );

  const slowest = workflowMetrics
    .filter((m) => m.totalExecutions > 0)
    .reduce((max, m) => (m.avgDuration > (max?.avgDuration || 0) ? m : max));

  const mostErrorProne = workflowMetrics
    .filter((m) => m.totalExecutions > 0 && m.failedExecutions > 0)
    .reduce((max, m) => ((1 - m.successRate) > (1 - (max?.successRate || 1)) ? m : max));

  const stats: AggregatedStats = {
    totalWorkflows: workflowMetrics.length,
    totalExecutions,
    totalSuccessful,
    totalFailed,
    overallSuccessRate: totalExecutions > 0 ? totalSuccessful / totalExecutions : 0,
    avgDuration: filteredExecutions.length > 0 ? totalDuration / filteredExecutions.length : 0,
    mostActiveWorkflow: mostActive
      ? {
          workflowId: mostActive.workflowId,
          workflowName: mostActive.workflowName,
          executionCount: mostActive.totalExecutions,
        }
      : undefined,
    slowestWorkflow: slowest
      ? {
          workflowId: slowest.workflowId,
          workflowName: slowest.workflowName,
          avgDuration: slowest.avgDuration,
        }
      : undefined,
    mostErrorProneWorkflow: mostErrorProne
      ? {
          workflowId: mostErrorProne.workflowId,
          workflowName: mostErrorProne.workflowName,
          errorRate: 1 - mostErrorProne.successRate,
        }
      : undefined,
  };

  return {
    generatedAt: new Date().toISOString(),
    timeRange: {
      start: typeof start === 'string' ? start : start.toISOString(),
      end: typeof end === 'string' ? end : end.toISOString(),
    },
    stats,
    workflowMetrics,
    recentExecutions: filteredExecutions.slice(-100).reverse(),
  };
}

/**
 * Clear metrics for a specific workflow or all workflows
 */
export function clearMetrics(workflowId?: string): void {
  if (workflowId) {
    // Clear specific workflow
    const executions = getExecutions();
    const filteredExecutions = executions.filter((e) => e.workflowId !== workflowId);
    saveExecutions(filteredExecutions);

    const metricsMap = getMetricsMap();
    delete metricsMap[workflowId];
    saveMetricsMap(metricsMap);
  } else {
    // Clear all metrics
    localStorage.removeItem(EXECUTIONS_STORAGE_KEY);
    localStorage.removeItem(METRICS_STORAGE_KEY);
  }
}

// ============================================================================
// Export Service Object
// ============================================================================

export const workflowAnalyticsService = {
  trackExecution,
  getWorkflowMetrics,
  getAllMetrics,
  getMetricsInDateRange,
  getMetricsByFolder,
  getMostUsedWorkflows,
  getSlowestWorkflows,
  getHighestErrorRateWorkflows,
  getRecentExecutions,
  calculateSuccessRate,
  calculateAvgDuration,
  getExecutionTimeline,
  getAggregatedStats,
  exportAnalyticsReport,
  clearMetrics,
};

export default workflowAnalyticsService;
