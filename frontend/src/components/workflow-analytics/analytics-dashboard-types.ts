import { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowMetrics,
  ExecutionRecord,
} from "@/services/workflow-analytics-service";

export interface AnalyticsDashboardProps {
  workflows: Workflow[];
  metrics: Record<string, WorkflowMetrics>;
  executions?: ExecutionRecord[];
  timeRange: { start: Date; end: Date };
  onTimeRangeChange: (range: { start: Date; end: Date }) => void;
  onRefresh?: () => void;
  className?: string;
}

export interface AggregatedMetrics {
  totalExecutions: number;
  totalSuccessful: number;
  totalFailed: number;
  avgSuccessRate: number;
  avgDuration: number;
  totalWorkflows: number;
}

export interface TopWorkflows {
  mostExecuted: WorkflowMetrics[];
  slowest: WorkflowMetrics[];
  highestError: WorkflowMetrics[];
}

export interface TimelineDataPoint {
  name: string;
  executions: number;
  success: number;
  failed: number;
}

export interface SuccessRateDataPoint {
  name: string;
  successRate: number;
  executions: number;
}

export interface DurationDataPoint {
  name: string;
  duration: number;
  minDuration: number;
  maxDuration: number;
}
