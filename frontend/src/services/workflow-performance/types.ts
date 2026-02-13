/**
 * Workflow Performance Analyzer Types
 *
 * All interfaces, types, and enums for the workflow performance analysis system.
 */

import type { ActionType } from "@/lib/action-schema/action-types";
import type { ActionExecutionState } from "@/stores/execution-store";

// ============================================================================
// Execution Data
// ============================================================================

/**
 * Execution data (optional - for dynamic analysis)
 */
export interface ExecutionData {
  /** Total execution time in milliseconds */
  totalDuration: number;

  /** Action states with timing info */
  actionStates: Record<string, ActionExecutionState>;

  /** Execution order */
  executionOrder?: string[];

  /** Variables at different points */
  variableSnapshots?: Array<{
    actionId: string;
    variables: Record<string, unknown>;
  }>;

  /** Critical path actions */
  criticalPath?: string[];
}

// ============================================================================
// Bottleneck Types
// ============================================================================

/**
 * Performance bottleneck
 */
export interface PerformanceBottleneck {
  /** Bottleneck type */
  type:
    | "slow_action"
    | "unnecessary_wait"
    | "sequential_operations"
    | "loop"
    | "resource_intensive";

  /** Severity (0-100, higher is worse) */
  severity: number;

  /** Action IDs involved */
  actionIds: string[];

  /** Description */
  description: string;

  /** Impact (estimated time savings in ms if fixed) */
  estimatedImpact: number;

  /** Suggestions for fixing */
  suggestions: string[];
}

// ============================================================================
// Optimization Types
// ============================================================================

/**
 * Optimization suggestion
 */
export interface OptimizationSuggestion {
  /** Suggestion type */
  type:
    | "parallelize"
    | "replace_wait"
    | "add_caching"
    | "optimize_loop"
    | "split_workflow"
    | "add_error_handling"
    | "remove_redundant"
    | "reduce_screenshots"
    | "add_wait"
    | "reduce_wait";

  /** Priority (1-5, 5 is highest) */
  priority: number;

  /** Action IDs involved */
  actionIds: string[];

  /** Title */
  title: string;

  /** Description */
  description: string;

  /** Expected speedup (percentage or ms) */
  expectedSpeedup?: number | string;

  /** Implementation difficulty (1-5) */
  difficulty?: number;
}

// ============================================================================
// Parallelization Types
// ============================================================================

/**
 * Parallelization opportunity
 */
export interface ParallelizationOpportunity {
  /** Groups of actions that can run in parallel */
  groups: string[][];

  /** Estimated speedup from parallelization */
  estimatedSpeedup: number;

  /** Why these actions can be parallelized */
  reason: string;

  /** Any concerns or caveats */
  caveats?: string[];
}

// ============================================================================
// Wait Analysis Types
// ============================================================================

/**
 * Wait action analysis
 */
export interface WaitAnalysis {
  /** Total wait time (ms) */
  totalWaitTime: number;

  /** Number of wait actions */
  waitCount: number;

  /** Fixed waits (could be dynamic) */
  fixedWaits: Array<{
    actionId: string;
    duration: number;
    suggestion: string;
  }>;

  /** Waits that are too long */
  longWaits: Array<{
    actionId: string;
    duration: number;
    suggestion: string;
  }>;

  /** Missing waits (actions that might need them) */
  missingWaits: Array<{
    actionId: string;
    reason: string;
  }>;

  /** Wait + Find patterns */
  waitFindPatterns: Array<{
    waitActionId: string;
    findActionId: string;
    suggestion: string;
  }>;
}

// ============================================================================
// Loop Analysis Types
// ============================================================================

/**
 * Loop analysis
 */
export interface LoopAnalysis {
  /** Number of loop actions */
  loopCount: number;

  /** Potential infinite loops */
  infiniteLoopRisks: Array<{
    actionId: string;
    reason: string;
    severity: "low" | "medium" | "high";
  }>;

  /** Estimated loop iterations */
  estimatedIterations: Record<string, number>;

  /** Optimization suggestions */
  suggestions: Array<{
    actionId: string;
    suggestion: string;
    type:
      | "early_exit"
      | "reduce_iterations"
      | "optimize_body"
      | "add_condition";
  }>;

  /** Nested loops */
  nestedLoops: Array<{
    parentLoopId: string;
    childLoopIds: string[];
    complexity: "linear" | "quadratic" | "cubic";
  }>;
}

// ============================================================================
// Resource Analysis Types
// ============================================================================

/**
 * Resource usage analysis
 */
export interface ResourceAnalysis {
  /** Number of screenshot operations */
  screenshotCount: number;

  /** Number of state transitions */
  stateTransitionCount: number;

  /** Heavy computation actions */
  heavyComputations: Array<{
    actionId: string;
    type: ActionType;
    reason: string;
  }>;

  /** Memory-intensive operations */
  memoryIntensive: Array<{
    actionId: string;
    type: ActionType;
    reason: string;
  }>;

  /** Resource usage score (0-100, higher is heavier) */
  resourceScore: number;
}

// ============================================================================
// Heatmap Types
// ============================================================================

/**
 * Performance heatmap data
 */
export interface PerformanceHeatmap {
  /** Action performance data */
  actionMetrics: Record<
    string,
    {
      /** Normalized performance score (0-100) */
      score: number;

      /** Duration in ms */
      duration?: number;

      /** Execution count */
      executionCount?: number;

      /** Status */
      status: "fast" | "normal" | "slow" | "critical";

      /** Color for visualization */
      color: string;
    }
  >;

  /** Overall metrics */
  overall: {
    averageDuration: number;
    maxDuration: number;
    minDuration: number;
  };
}

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Comprehensive performance analysis result
 */
export interface PerformanceAnalysisResult {
  /** Overall performance score (0-100, higher is better) */
  performanceScore: number;

  /** Bottleneck score (0-100, higher is worse) */
  bottleneckScore: number;

  /** Total estimated execution time (ms) */
  estimatedExecutionTime: number;

  /** Actual execution time if available (ms) */
  actualExecutionTime?: number;

  /** Identified bottlenecks */
  bottlenecks: PerformanceBottleneck[];

  /** Optimization suggestions */
  suggestions: OptimizationSuggestion[];

  /** Parallelization opportunities */
  parallelizationOpportunities: ParallelizationOpportunity[];

  /** Wait analysis */
  waitAnalysis: WaitAnalysis;

  /** Loop analysis */
  loopAnalysis: LoopAnalysis;

  /** Resource analysis */
  resourceAnalysis: ResourceAnalysis;

  /** Critical path (slowest sequence) */
  criticalPath?: string[];

  /** Action timings */
  actionTimings?: Record<string, number>;

  /** Performance heatmap */
  heatmap: PerformanceHeatmap;

  /** Analysis timestamp */
  timestamp: Date;
}

// ============================================================================
// Comparison Types
// ============================================================================

/**
 * Performance comparison result
 */
export interface PerformanceComparison {
  /** Workflow 1 analysis */
  workflow1: PerformanceAnalysisResult;

  /** Workflow 2 analysis */
  workflow2: PerformanceAnalysisResult;

  /** Differences */
  differences: {
    performanceScoreDelta: number;
    executionTimeDelta: number;
    bottleneckScoreDelta: number;
    actionCountDelta: number;
  };

  /** Summary */
  summary: string;

  /** Better workflow */
  winner: "workflow1" | "workflow2" | "tie";
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Action timing estimates (ms) - rough estimates for static analysis
 */
export const ACTION_TIME_ESTIMATES: Partial<Record<ActionType, number>> = {
  FIND: 500,
  VANISH: 500,
  CLICK: 100,
  MOUSE_MOVE: 50,
  MOUSE_DOWN: 50,
  MOUSE_UP: 50,
  DRAG: 200,
  SCROLL: 100,
  TYPE: 200,
  KEY_PRESS: 50,
  KEY_DOWN: 25,
  KEY_UP: 25,
  HOTKEY: 100,
  IF: 10,
  LOOP: 50,
  SWITCH: 20,
  TRY_CATCH: 10,
  SET_VARIABLE: 5,
  GET_VARIABLE: 5,
  GO_TO_STATE: 100,
  RUN_WORKFLOW: 1000,
  SCREENSHOT: 300,
};
