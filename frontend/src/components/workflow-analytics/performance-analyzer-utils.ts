/**
 * Performance Analyzer Utilities
 *
 * Pure helper functions, constants, and mock data generator
 * for the PerformanceAnalyzer component.
 */

import { Workflow } from "@/lib/action-schema/action-types";
import { Clock, GitBranch, Repeat, Sparkles, XCircle } from "lucide-react";
import type {
  ActionTiming,
  Bottleneck,
  LoopAnalysis,
  OptimizationSuggestion,
  ParallelizationOpportunity,
  PerformanceData,
  WaitAnalysis,
} from "./performance-analyzer-types";

// ============================================================================
// Constants
// ============================================================================

export const SEVERITY_COLORS = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#ef4444",
};

export const SUGGESTION_ICONS = {
  parallelization: GitBranch,
  "wait-optimization": Clock,
  "loop-optimization": Repeat,
  caching: Sparkles,
  "action-removal": XCircle,
};

// ============================================================================
// Formatting Functions
// ============================================================================

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function getSeverityColor(severity: string): string {
  return (
    SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ||
    SEVERITY_COLORS.low
  );
}

// ============================================================================
// Mock Data Generator (for demonstration)
// ============================================================================

export function generateMockPerformanceData(
  workflow: Workflow
): PerformanceData {
  const actionTimings: ActionTiming[] = workflow.actions.map(
    (action, index) => ({
      actionId: action.id,
      actionName: action.name || `Action ${index + 1}`,
      actionType: action.type,
      duration: Math.random() * 5000 + 500,
      percentile: Math.random() * 100,
    })
  );

  const totalDuration = actionTimings.reduce((sum, t) => sum + t.duration, 0);

  const bottlenecks: Bottleneck[] = actionTimings
    .filter((t) => t.duration > totalDuration * 0.1)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map((t) => ({
      actionId: t.actionId,
      actionName: t.actionName,
      actionType: t.actionType,
      duration: t.duration,
      percentOfTotal: (t.duration / totalDuration) * 100,
      severity:
        t.duration > totalDuration * 0.3
          ? "high"
          : t.duration > totalDuration * 0.2
            ? "medium"
            : "low",
    }));

  const suggestions: OptimizationSuggestion[] = [
    {
      id: "opt-1",
      type: "parallelization",
      severity: "high",
      title: "Parallelize Independent Actions",
      description:
        "Actions 3, 4, and 5 can be executed in parallel as they have no dependencies.",
      estimatedImprovement: 2500,
      impactPercentage: 25,
      affectedActions: workflow.actions.slice(2, 5).map((a) => a.id),
    },
    {
      id: "opt-2",
      type: "wait-optimization",
      severity: "medium",
      title: "Optimize Timeout Duration",
      description:
        "VANISH action is using a long timeout. Consider reducing the timeout duration or using a FIND action with FIRST strategy.",
      estimatedImprovement: 3000,
      impactPercentage: 30,
      affectedActions: workflow.actions
        .filter((a) => a.type === "VANISH")
        .map((a) => a.id),
    },
    {
      id: "opt-3",
      type: "loop-optimization",
      severity: "medium",
      title: "Reduce Loop Iterations",
      description:
        "Loop is executing 50 times. Consider batching operations or reducing iterations.",
      estimatedImprovement: 1500,
      impactPercentage: 15,
      affectedActions: workflow.actions
        .filter((a) => a.type === "LOOP")
        .map((a) => a.id),
    },
    {
      id: "opt-4",
      type: "caching",
      severity: "low",
      title: "Cache Pattern Search Results",
      description:
        "Multiple FIND actions search for the same pattern. Cache results to avoid redundant searches.",
      estimatedImprovement: 800,
      impactPercentage: 8,
      affectedActions: workflow.actions
        .filter((a) => a.type === "FIND")
        .map((a) => a.id),
    },
  ];

  const parallelizationOpportunities: ParallelizationOpportunity[] = [
    {
      groupId: "group-1",
      actions: workflow.actions.slice(2, 5).map((a) => a.id),
      currentDuration: 7500,
      parallelDuration: 5000,
      savings: 2500,
    },
  ];

  const waitAnalysis: WaitAnalysis[] = workflow.actions
    .filter((a) => a.type === "VANISH")
    .map((a, i) => ({
      actionId: a.id,
      actionName: a.name || `Vanish ${i + 1}`,
      waitDuration: 5000,
      suggestion: "Reduce timeout duration or use FIND with FIRST strategy",
      potentialSavings: 3000,
    }));

  const loopAnalysis: LoopAnalysis[] = workflow.actions
    .filter((a) => a.type === "LOOP")
    .map((a, i) => ({
      actionId: a.id,
      actionName: a.name || `Loop ${i + 1}`,
      estimatedIterations: 50,
      avgIterationDuration: 100,
      totalDuration: 5000,
      suggestion: "Batch operations or use parallel execution",
      potentialSavings: 1500,
    }));

  const estimatedOptimizedDuration =
    totalDuration -
    suggestions.reduce((sum, s) => sum + s.estimatedImprovement, 0);

  return {
    bottlenecks,
    actionTimings,
    suggestions,
    parallelizationOpportunities,
    waitAnalysis,
    loopAnalysis,
    totalDuration,
    estimatedOptimizedDuration,
  };
}
