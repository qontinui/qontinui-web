/**
 * Performance Analyzer Types
 *
 * Shared type definitions for the PerformanceAnalyzer component
 * and its sub-components.
 */

import { Workflow } from "@/lib/action-schema/action-types";

export interface PerformanceAnalyzerProps {
  workflow: Workflow;
  performanceData?: PerformanceData;
  onAnalyze: () => void;
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void;
  className?: string;
}

export interface PerformanceData {
  bottlenecks: Bottleneck[];
  actionTimings: ActionTiming[];
  suggestions: OptimizationSuggestion[];
  parallelizationOpportunities: ParallelizationOpportunity[];
  waitAnalysis: WaitAnalysis[];
  loopAnalysis: LoopAnalysis[];
  totalDuration: number;
  estimatedOptimizedDuration: number;
}

export interface Bottleneck {
  actionId: string;
  actionName: string;
  actionType: string;
  duration: number;
  percentOfTotal: number;
  severity: "low" | "medium" | "high";
}

export interface ActionTiming {
  actionId: string;
  actionName: string;
  actionType: string;
  duration: number;
  percentile: number;
}

export interface OptimizationSuggestion {
  id: string;
  type:
    | "parallelization"
    | "wait-optimization"
    | "loop-optimization"
    | "caching"
    | "action-removal";
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  estimatedImprovement: number; // Time saved in ms
  impactPercentage: number; // % of total time
  affectedActions: string[];
  applied?: boolean;
}

export interface ParallelizationOpportunity {
  groupId: string;
  actions: string[];
  currentDuration: number;
  parallelDuration: number;
  savings: number;
}

export interface WaitAnalysis {
  actionId: string;
  actionName: string;
  waitDuration: number;
  suggestion: string;
  potentialSavings: number;
}

export interface LoopAnalysis {
  actionId: string;
  actionName: string;
  estimatedIterations: number;
  avgIterationDuration: number;
  totalDuration: number;
  suggestion: string;
  potentialSavings: number;
}

export interface HeatmapDataPoint {
  name: string;
  duration: number;
  fill: string;
}
