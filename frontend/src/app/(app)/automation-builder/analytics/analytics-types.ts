import type { ExecutionRecord } from "@/services/workflow-analytics-service";
import type { WorkflowMetrics } from "@/services/workflow-analytics-service";
import type { AggregatedStats } from "@/services/workflow-analytics-service";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { ComplexityAnalysis } from "@/services/workflow-complexity-analyzer";
import type { TestResult } from "@/services/workflow-testing-service";

export type TimeRangePreset =
  | "today"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "custom";

export interface FilterState {
  folder?: string;
  tag?: string;
  category?: string;
  status?: "success" | "failure" | "all";
  complexityLevel?: "low" | "medium" | "high" | "very-high" | "all";
  searchQuery?: string;
}

export interface TopWorkflows {
  mostExecuted: WorkflowMetrics[];
  slowest: WorkflowMetrics[];
  highestError: WorkflowMetrics[];
  recentlyFailed: ExecutionRecord[];
}

export interface SelectedWorkflowData {
  workflow: Workflow;
  metrics: WorkflowMetrics;
  complexityMetrics: ComplexityAnalysis;
  executionHistory: TestResult[];
}

export type {
  ExecutionRecord,
  WorkflowMetrics,
  AggregatedStats,
  Workflow,
  ComplexityAnalysis,
  TestResult,
};
