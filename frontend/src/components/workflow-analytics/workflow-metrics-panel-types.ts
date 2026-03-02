import { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowMetrics } from "@/services/workflow-analytics-service";
import { ComplexityAnalysis } from "@/services/workflow-complexity-analyzer";
import { TestResult } from "@/services/workflow-testing-service";

export interface WorkflowMetricsPanelProps {
  workflow: Workflow;
  metrics: WorkflowMetrics;
  complexityMetrics: ComplexityAnalysis;
  executionHistory: TestResult[];
  className?: string;
}

export interface WorkflowMetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  subtitle?: string;
  variant?: "default" | "success" | "warning" | "error";
}

export interface TimelineDataPoint {
  index: number;
  duration: number;
  success: number;
  failed: number;
  timestamp: string;
}

export interface BreakdownDataPoint {
  [key: string]: unknown;
  name: string;
  value: number;
  color: string;
}

export interface PerformanceTrendDataPoint {
  run: string;
  duration: number;
  avgDuration: number;
  timestamp: string;
}

export interface SuccessRateTrendDataPoint {
  run: string;
  successRate: number;
  total: number;
}

export interface ComplexityTableRow {
  metric: string;
  value: string | number;
  description: string;
}
