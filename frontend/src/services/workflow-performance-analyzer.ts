/**
 * Workflow Performance Analyzer
 *
 * Comprehensive service for analyzing workflow performance, identifying bottlenecks,
 * and suggesting optimizations. Works with or without real execution data.
 *
 * Features:
 * - Performance analysis (static and dynamic)
 * - Bottleneck identification
 * - Parallelization opportunities
 * - Wait analysis
 * - Loop analysis
 * - Resource usage analysis
 * - Performance reports and heatmaps
 * - Optimization suggestions
 */

import type {
  Workflow,
  Action,
  ActionType,
} from "@/lib/action-schema/action-types";
import type { ActionExecutionState } from "@/stores/execution-store";

// ============================================================================
// Types
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
// Performance Analyzer Service
// ============================================================================

export class WorkflowPerformanceAnalyzer {
  private static readonly STORAGE_KEY = "workflow-performance-analysis";
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private cache: Map<
    string,
    { data: PerformanceAnalysisResult; timestamp: number }
  > = new Map();

  // Action timing estimates (ms) - rough estimates for static analysis
  private static readonly ACTION_TIME_ESTIMATES: Partial<
    Record<ActionType, number>
  > = {
    FIND: 500,
    EXISTS: 200,
    VANISH: 500,
    WAIT: 1000,
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

  // ============================================================================
  // Main Analysis Methods
  // ============================================================================

  /**
   * Comprehensive performance analysis
   */
  analyzePerformance(
    workflow: Workflow,
    executionData?: ExecutionData
  ): PerformanceAnalysisResult {
    // Check cache
    const cached = this.getCachedAnalysis(workflow.id, executionData);
    if (cached) {
      return cached;
    }

    // Perform analysis
    const bottlenecks = this.identifyBottlenecks(workflow, executionData);
    const waitAnalysis = this.analyzeWaitActions(workflow);
    const loopAnalysis = this.analyzeLoops(workflow);
    const resourceAnalysis = this.analyzeResourceUsage(workflow);
    const parallelizationOpportunities =
      this.analyzeParallelizationOpportunities(workflow);
    const suggestions = this.generateSuggestions(workflow, executionData);

    const estimatedExecutionTime = this.estimateExecutionTime(workflow);
    const actualExecutionTime = executionData?.totalDuration;
    const actionTimings = executionData
      ? this.getActionTimings(executionData)
      : undefined;
    const criticalPath = executionData
      ? this.getCriticalPath(executionData)
      : undefined;
    const bottleneckScore = this.getBottleneckScore(workflow, executionData);
    const performanceScore = this.calculatePerformanceScore(
      workflow,
      executionData,
      bottleneckScore
    );
    const heatmap = this.generatePerformanceHeatmap(workflow, executionData);

    const result: PerformanceAnalysisResult = {
      performanceScore,
      bottleneckScore,
      estimatedExecutionTime,
      actualExecutionTime,
      bottlenecks,
      suggestions,
      parallelizationOpportunities,
      waitAnalysis,
      loopAnalysis,
      resourceAnalysis,
      criticalPath,
      actionTimings,
      heatmap,
      timestamp: new Date(),
    };

    // Cache result
    this.cacheAnalysis(workflow.id, result);

    return result;
  }

  /**
   * Identify bottlenecks in workflow
   */
  identifyBottlenecks(
    workflow: Workflow,
    executionData?: ExecutionData
  ): PerformanceBottleneck[] {
    const bottlenecks: PerformanceBottleneck[] = [];

    // 1. Slow actions (if execution data available)
    if (executionData) {
      const slowActions = this.getSlowestActions(workflow, executionData, 5);
      const avgDuration = this.getAverageDuration(executionData);

      for (const { actionId, duration } of slowActions) {
        if (duration > avgDuration * 2) {
          const action = workflow.actions.find((a) => a.id === actionId);
          bottlenecks.push({
            type: "slow_action",
            severity: Math.min(100, (duration / avgDuration - 1) * 50),
            actionIds: [actionId],
            description: `Action "${action?.name || action?.type}" takes ${duration}ms, which is ${Math.round(duration / avgDuration)}x longer than average`,
            estimatedImpact: duration - avgDuration,
            suggestions: [
              "Review action configuration for inefficiencies",
              "Consider using a more efficient approach",
              "Check if this action can be cached or optimized",
            ],
          });
        }
      }
    }

    // 2. Unnecessary waits
    const unnecessaryWaits = this.getUnnecessaryWaits(workflow);
    if (unnecessaryWaits.length > 0) {
      const totalWaitTime = unnecessaryWaits.reduce(
        (sum, w) => sum + (w.config.duration || 0),
        0
      );
      bottlenecks.push({
        type: "unnecessary_wait",
        severity: Math.min(100, unnecessaryWaits.length * 20),
        actionIds: unnecessaryWaits.map((w) => w.id),
        description: `${unnecessaryWaits.length} fixed WAIT actions totaling ${totalWaitTime}ms could be made dynamic`,
        estimatedImpact: totalWaitTime * 0.5, // Assume 50% savings
        suggestions: [
          "Replace fixed WAITs with FIND actions",
          "Use WAIT with conditions instead of fixed durations",
          "Consider using EXISTS checks instead of WAITs",
        ],
      });
    }

    // 3. Sequential operations that could be parallel
    const sequentialGroups =
      this.findSequentialOperationsThatCouldBeParallel(workflow);
    for (const group of sequentialGroups) {
      bottlenecks.push({
        type: "sequential_operations",
        severity: Math.min(100, group.length * 15),
        actionIds: group,
        description: `${group.length} independent actions are running sequentially but could run in parallel`,
        estimatedImpact: this.estimateParallelSpeedup(workflow, group),
        suggestions: [
          "Execute these actions in parallel",
          "Group independent operations together",
          "Consider using parallel branches",
        ],
      });
    }

    // 4. Inefficient loops
    const loopActions = this.getActionsByType(workflow, "LOOP");
    for (const loopAction of loopActions) {
      const loopComplexity = this.analyzeLoopComplexity(
        workflow,
        loopAction.id
      );
      if (loopComplexity.estimatedIterations > 100) {
        bottlenecks.push({
          type: "loop",
          severity: Math.min(100, loopComplexity.estimatedIterations / 10),
          actionIds: [loopAction.id],
          description: `Loop potentially iterates ${loopComplexity.estimatedIterations} times, which may be excessive`,
          estimatedImpact: loopComplexity.estimatedIterations * 100, // Rough estimate
          suggestions: [
            "Add early exit conditions",
            "Reduce number of iterations",
            "Optimize loop body",
            "Consider alternative approaches",
          ],
        });
      }
    }

    // 5. Resource-intensive operations
    const screenshotActions = this.getActionsByType(workflow, "SCREENSHOT");
    if (screenshotActions.length > 5) {
      bottlenecks.push({
        type: "resource_intensive",
        severity: Math.min(100, screenshotActions.length * 10),
        actionIds: screenshotActions.map((a) => a.id),
        description: `${screenshotActions.length} screenshot operations may impact performance`,
        estimatedImpact: screenshotActions.length * 300,
        suggestions: [
          "Reduce number of screenshots",
          "Cache screenshots when possible",
          "Use screenshots only when necessary",
        ],
      });
    }

    // Sort by severity
    bottlenecks.sort((a, b) => b.severity - a.severity);

    return bottlenecks;
  }

  /**
   * Get slowest actions from execution data
   */
  getSlowestActions(
    _workflow: Workflow,
    executionData: ExecutionData,
    limit: number = 10
  ): Array<{ actionId: string; duration: number }> {
    const timings: Array<{ actionId: string; duration: number }> = [];

    for (const [actionId, state] of Object.entries(
      executionData.actionStates
    )) {
      if (state.duration !== undefined) {
        timings.push({ actionId, duration: state.duration });
      }
    }

    // Sort by duration (descending)
    timings.sort((a, b) => b.duration - a.duration);

    return timings.slice(0, limit);
  }

  /**
   * Get unnecessary wait actions
   */
  getUnnecessaryWaits(workflow: Workflow): Action<"WAIT">[] {
    const unnecessaryWaits: Action<"WAIT">[] = [];

    for (const action of workflow.actions) {
      if (action.type === "WAIT") {
        const waitAction = action as Action<"WAIT">;

        // Fixed time waits are often unnecessary
        if (
          waitAction.config.waitFor === "time" &&
          waitAction.config.duration
        ) {
          // Check if there's a FIND action right after this
          const nextActions = this.getNextActions(workflow, action.id);
          const hasFind = nextActions.some(
            (a) => a.type === "FIND" || a.type === "EXISTS"
          );

          if (hasFind) {
            unnecessaryWaits.push(waitAction);
          }
        }
      }
    }

    return unnecessaryWaits;
  }

  /**
   * Get redundant operations
   */
  getRedundantOperations(workflow: Workflow): Action[][] {
    const redundantGroups: Action[][] = [];
    const seenConfigs = new Map<string, Action[]>();

    // Find actions with identical configurations
    for (const action of workflow.actions) {
      // Skip control flow actions
      if (["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(action.type)) {
        continue;
      }

      const configHash = this.hashActionConfig(action);
      const existing = seenConfigs.get(configHash);

      if (existing) {
        existing.push(action);
      } else {
        seenConfigs.set(configHash, [action]);
      }
    }

    // Return groups with 2+ identical actions
    for (const group of seenConfigs.values()) {
      if (group.length >= 2) {
        redundantGroups.push(group);
      }
    }

    return redundantGroups;
  }

  /**
   * Analyze parallelization opportunities
   */
  analyzeParallelizationOpportunities(
    workflow: Workflow
  ): ParallelizationOpportunity[] {
    const opportunities: ParallelizationOpportunity[] = [];
    const parallelGroups = this.findParallelizableActions(workflow);

    for (const group of parallelGroups) {
      if (group.length < 2) continue;

      const estimatedSpeedup = this.estimateParallelSpeedup(workflow, group);

      opportunities.push({
        groups: [group],
        estimatedSpeedup,
        reason:
          "These actions have no data dependencies and can execute simultaneously",
        caveats: [
          "Ensure actions don't interfere with each other",
          "Consider system resource limits",
          "Test thoroughly after parallelization",
        ],
      });
    }

    return opportunities;
  }

  /**
   * Find groups of actions that can be parallelized
   */
  findParallelizableActions(workflow: Workflow): string[][] {
    const groups: string[][] = [];
    const visited = new Set<string>();

    // Build dependency graph
    const dependencies = this.buildDependencyGraph(workflow);

    for (const action of workflow.actions) {
      if (visited.has(action.id)) continue;

      // Find all actions at the same "level" (no dependencies between them)
      const group = this.findIndependentActions(
        workflow,
        action.id,
        dependencies,
        visited
      );

      if (group.length >= 2) {
        groups.push(group);
        group.forEach((id) => visited.add(id));
      }
    }

    return groups;
  }

  /**
   * Validate if actions can be parallelized
   */
  validateParallelization(
    workflow: Workflow,
    actionIds: string[]
  ): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for data dependencies
    const dependencies = this.buildDependencyGraph(workflow);

    for (let i = 0; i < actionIds.length; i++) {
      for (let j = i + 1; j < actionIds.length; j++) {
        const id1 = actionIds[i] ?? "";
        const id2 = actionIds[j] ?? "";

        if (
          dependencies.get(id1)?.has(id2) ||
          dependencies.get(id2)?.has(id1)
        ) {
          issues.push(`Actions ${id1} and ${id2} have data dependencies`);
        }
      }
    }

    // Check for conflicting operations
    const actions = actionIds
      .map((id) => workflow.actions.find((a) => a.id === id)!)
      .filter(Boolean);
    const hasMouseActions = actions.some((a) =>
      ["CLICK", "MOUSE_MOVE", "DRAG"].includes(a.type)
    );
    const hasKeyboardActions = actions.some((a) =>
      ["TYPE", "KEY_PRESS", "HOTKEY"].includes(a.type)
    );

    if (hasMouseActions && hasKeyboardActions) {
      issues.push("Mouse and keyboard actions may interfere with each other");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Estimate speedup from parallelization
   */
  estimateParallelSpeedup(
    workflow: Workflow,
    parallelActionIds: string[]
  ): number {
    let totalSequentialTime = 0;

    for (const actionId of parallelActionIds) {
      const action = workflow.actions.find((a) => a.id === actionId);
      if (action) {
        totalSequentialTime += this.estimateActionTime(action);
      }
    }

    // Assume parallel execution takes as long as the longest action
    const longestTime = Math.max(
      ...parallelActionIds.map((id) => {
        const action = workflow.actions.find((a) => a.id === id);
        return action ? this.estimateActionTime(action) : 0;
      })
    );

    return totalSequentialTime - longestTime;
  }

  // ============================================================================
  // Execution Data Analysis
  // ============================================================================

  /**
   * Analyze execution timing from execution data
   */
  analyzeExecutionTiming(executionData: ExecutionData): {
    totalDuration: number;
    averageDuration: number;
    slowestAction: { actionId: string; duration: number } | null;
    fastestAction: { actionId: string; duration: number } | null;
  } {
    const durations = Object.entries(executionData.actionStates)
      .filter(([_, state]) => state.duration !== undefined)
      .map(([actionId, state]) => ({ actionId, duration: state.duration! }));

    if (durations.length === 0) {
      return {
        totalDuration: executionData.totalDuration,
        averageDuration: 0,
        slowestAction: null,
        fastestAction: null,
      };
    }

    const avgDuration =
      durations.reduce((sum, d) => sum + d.duration, 0) / durations.length;
    const slowest = durations.reduce((max, d) =>
      d.duration > max.duration ? d : max
    );
    const fastest = durations.reduce((min, d) =>
      d.duration < min.duration ? d : min
    );

    return {
      totalDuration: executionData.totalDuration,
      averageDuration: avgDuration,
      slowestAction: slowest,
      fastestAction: fastest,
    };
  }

  /**
   * Get action timings from execution data
   */
  getActionTimings(executionData: ExecutionData): Record<string, number> {
    const timings: Record<string, number> = {};

    for (const [actionId, state] of Object.entries(
      executionData.actionStates
    )) {
      if (state.duration !== undefined) {
        timings[actionId] = state.duration;
      }
    }

    return timings;
  }

  /**
   * Get critical path (slowest path through workflow)
   * Uses a dynamic programming approach to find the longest path by execution time
   */
  getCriticalPath(executionData: ExecutionData): string[] {
    if (executionData.criticalPath) {
      return executionData.criticalPath;
    }

    // If no execution order provided, return empty
    if (!executionData.executionOrder) {
      return [];
    }

    // Get action timings
    const timings = this.getActionTimings(executionData);

    // If no timing data available, return execution order
    if (Object.keys(timings).length === 0) {
      return executionData.executionOrder;
    }

    // Build adjacency list from execution order (simplified graph)
    // This creates a sequential graph based on execution order
    const actionIds = executionData.executionOrder;
    const graph = new Map<string, string[]>();

    // Create edges between consecutive actions
    for (let i = 0; i < actionIds.length - 1; i++) {
      const current = actionIds[i] ?? "";
      const next = actionIds[i + 1] ?? "";

      if (!graph.has(current)) {
        graph.set(current, []);
      }
      graph.get(current)!.push(next);
    }

    // Find the path with maximum total duration
    // Use dynamic programming: maxTime[action] = max time to reach this action
    const maxTime = new Map<string, number>();
    const parent = new Map<string, string | null>();

    // Initialize first action
    const startAction = actionIds[0] ?? "";
    maxTime.set(startAction, timings[startAction] || 0);
    parent.set(startAction, null);

    // Process actions in execution order
    for (const actionId of actionIds) {
      const currentTime = maxTime.get(actionId) || 0;
      const neighbors = graph.get(actionId) || [];

      for (const neighbor of neighbors) {
        const neighborDuration = timings[neighbor] || 0;
        const newTime = currentTime + neighborDuration;
        const existingTime = maxTime.get(neighbor) || 0;

        // Update if this path is longer
        if (newTime > existingTime) {
          maxTime.set(neighbor, newTime);
          parent.set(neighbor, actionId);
        }
      }
    }

    // Find the action with maximum total time
    let endAction = actionIds[actionIds.length - 1] ?? "";
    let maxTotalTime = maxTime.get(endAction) || 0;

    for (const actionId of actionIds) {
      const time = maxTime.get(actionId) || 0;
      if (time > maxTotalTime) {
        maxTotalTime = time;
        endAction = actionId;
      }
    }

    // Reconstruct the critical path by backtracking
    const criticalPath: string[] = [];
    let current: string | null = endAction;

    while (current !== null) {
      criticalPath.unshift(current);
      current = parent.get(current) || null;
    }

    return criticalPath;
  }

  /**
   * Calculate bottleneck score (0-100, higher is worse)
   */
  getBottleneckScore(
    workflow: Workflow,
    executionData?: ExecutionData
  ): number {
    let score = 0;

    // Factor 1: Action count (more actions = more potential bottlenecks)
    const actionCount = workflow.actions.length;
    score += Math.min(20, actionCount / 5);

    // Factor 2: Sequential vs parallel structure
    const parallelizableGroups = this.findParallelizableActions(workflow);
    const parallelizableCount = parallelizableGroups.reduce(
      (sum, g) => sum + g.length,
      0
    );
    const sequentialRatio = (actionCount - parallelizableCount) / actionCount;
    score += sequentialRatio * 30;

    // Factor 3: Wait actions
    const waitCount = this.countWaitActions(workflow);
    score += Math.min(20, waitCount * 5);

    // Factor 4: Execution time variance (if execution data available)
    if (executionData) {
      const durations = Object.values(executionData.actionStates)
        .filter((s) => s.duration !== undefined)
        .map((s) => s.duration!);

      if (durations.length > 0) {
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        const variance =
          durations.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) /
          durations.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = stdDev / avg;

        // High variance indicates bottlenecks
        score += Math.min(30, coefficientOfVariation * 100);
      }
    }

    return Math.min(100, score);
  }

  // ============================================================================
  // Static Analysis
  // ============================================================================

  /**
   * Estimate execution time based on action types
   */
  estimateExecutionTime(workflow: Workflow): number {
    let totalTime = 0;

    for (const action of workflow.actions) {
      totalTime += this.estimateActionTime(action);
    }

    return totalTime;
  }

  /**
   * Estimate time for a single action
   */
  private estimateActionTime(action: Action): number {
    const baseTime =
      WorkflowPerformanceAnalyzer.ACTION_TIME_ESTIMATES[action.type] || 100;

    // Adjust for specific configurations
    if (action.type === "WAIT") {
      const waitAction = action as Action<"WAIT">;
      if (waitAction.config.waitFor === "time" && waitAction.config.duration) {
        return waitAction.config.duration;
      }
    }

    if (action.type === "LOOP") {
      const loopAction = action as Action<"LOOP">;
      const iterations = loopAction.config.maxIterations || 10;
      return baseTime * iterations;
    }

    return baseTime;
  }

  /**
   * Count WAIT actions
   */
  countWaitActions(workflow: Workflow): number {
    return workflow.actions.filter((a) => a.type === "WAIT").length;
  }

  /**
   * Count FIND actions
   */
  countFindActions(workflow: Workflow): number {
    return workflow.actions.filter(
      (a) => a.type === "FIND" || a.type === "EXISTS"
    ).length;
  }

  /**
   * Get actions by type
   */
  getActionsByType<T extends ActionType>(
    workflow: Workflow,
    actionType: T
  ): Action<T>[] {
    return workflow.actions.filter((a) => a.type === actionType) as Action<T>[];
  }

  /**
   * Analyze loop complexity
   */
  analyzeLoopComplexity(
    workflow: Workflow,
    loopActionId: string
  ): {
    estimatedIterations: number;
    hasNestedLoops: boolean;
    nestedDepth: number;
  } {
    const loopAction = workflow.actions.find((a) => a.id === loopActionId) as
      | Action<"LOOP">
      | undefined;

    if (!loopAction) {
      return { estimatedIterations: 0, hasNestedLoops: false, nestedDepth: 0 };
    }

    const maxIterations = loopAction.config.maxIterations || 100;
    const nestedLoops = this.findNestedLoops(workflow, loopActionId);

    return {
      estimatedIterations: maxIterations,
      hasNestedLoops: nestedLoops.length > 0,
      nestedDepth: nestedLoops.length,
    };
  }

  // ============================================================================
  // Wait Analysis
  // ============================================================================

  /**
   * Analyze wait actions
   */
  analyzeWaitActions(workflow: Workflow): WaitAnalysis {
    const waitActions = this.getActionsByType(workflow, "WAIT");
    let totalWaitTime = 0;
    const fixedWaits: WaitAnalysis["fixedWaits"] = [];
    const longWaits: WaitAnalysis["longWaits"] = [];
    const missingWaits: WaitAnalysis["missingWaits"] = [];
    const waitFindPatterns: WaitAnalysis["waitFindPatterns"] = [];

    // Analyze existing waits
    for (const waitAction of waitActions) {
      if (waitAction.config.waitFor === "time" && waitAction.config.duration) {
        const duration = waitAction.config.duration;
        totalWaitTime += duration;

        // Fixed wait that could be dynamic
        fixedWaits.push({
          actionId: waitAction.id,
          duration,
          suggestion:
            "Consider replacing with condition-based wait or FIND action",
        });

        // Long wait
        if (duration > 5000) {
          longWaits.push({
            actionId: waitAction.id,
            duration,
            suggestion: `${duration}ms is quite long. Consider reducing or making dynamic.`,
          });
        }

        // Check for WAIT + FIND pattern
        const nextActions = this.getNextActions(workflow, waitAction.id);
        const findAction = nextActions.find((a) => a.type === "FIND");

        if (findAction) {
          waitFindPatterns.push({
            waitActionId: waitAction.id,
            findActionId: findAction.id,
            suggestion: "FIND action could replace WAIT with built-in waiting",
          });
        }
      }
    }

    // Find missing waits
    for (const action of workflow.actions) {
      // Actions that might need waits before them
      if (action.type === "CLICK" || action.type === "TYPE") {
        const prevActions = this.getPreviousActions(workflow, action.id);
        const hasWaitOrFind = prevActions.some(
          (a) => a.type === "WAIT" || a.type === "FIND"
        );

        if (!hasWaitOrFind && prevActions.length > 0) {
          missingWaits.push({
            actionId: action.id,
            reason: `${action.type} action might need a WAIT or FIND before it to ensure UI is ready`,
          });
        }
      }
    }

    return {
      totalWaitTime,
      waitCount: waitActions.length,
      fixedWaits,
      longWaits,
      missingWaits,
      waitFindPatterns,
    };
  }

  // ============================================================================
  // Loop Analysis
  // ============================================================================

  /**
   * Analyze loops in workflow
   */
  analyzeLoops(workflow: Workflow): LoopAnalysis {
    const loopActions = this.getActionsByType(workflow, "LOOP");
    const infiniteLoopRisks: LoopAnalysis["infiniteLoopRisks"] = [];
    const estimatedIterations: Record<string, number> = {};
    const suggestions: LoopAnalysis["suggestions"] = [];
    const nestedLoops: LoopAnalysis["nestedLoops"] = [];

    for (const loopAction of loopActions) {
      const iterations = loopAction.config.maxIterations || 100;
      estimatedIterations[loopAction.id] = iterations;

      // Check for infinite loop risks
      if (!loopAction.config.maxIterations) {
        infiniteLoopRisks.push({
          actionId: loopAction.id,
          reason: "No maximum iteration limit set",
          severity: "high",
        });
      }

      if (!loopAction.config.condition) {
        infiniteLoopRisks.push({
          actionId: loopAction.id,
          reason: "No exit condition defined",
          severity: "high",
        });
      }

      // Suggest optimizations
      if (iterations > 50) {
        suggestions.push({
          actionId: loopAction.id,
          suggestion:
            "Consider adding early exit condition to avoid unnecessary iterations",
          type: "early_exit",
        });
      }

      // Check for nested loops
      const nested = this.findNestedLoops(workflow, loopAction.id);
      if (nested.length > 0) {
        nestedLoops.push({
          parentLoopId: loopAction.id,
          childLoopIds: nested,
          complexity: nested.length === 1 ? "quadratic" : "cubic",
        });

        suggestions.push({
          actionId: loopAction.id,
          suggestion:
            "Nested loops can significantly impact performance. Consider optimizing or restructuring.",
          type: "optimize_body",
        });
      }
    }

    return {
      loopCount: loopActions.length,
      infiniteLoopRisks,
      estimatedIterations,
      suggestions,
      nestedLoops,
    };
  }

  /**
   * Detect potential infinite loops
   */
  detectInfiniteLoops(workflow: Workflow): string[] {
    const riskyLoops: string[] = [];

    for (const action of workflow.actions) {
      if (action.type === "LOOP") {
        const loopAction = action as Action<"LOOP">;

        // No max iterations and no break condition = high risk
        if (
          !loopAction.config.maxIterations &&
          !this.hasBreakAction(workflow, action.id)
        ) {
          riskyLoops.push(action.id);
        }
      }
    }

    return riskyLoops;
  }

  /**
   * Estimate loop iterations
   */
  estimateLoopIterations(workflow: Workflow): Record<string, number> {
    const iterations: Record<string, number> = {};

    for (const action of workflow.actions) {
      if (action.type === "LOOP") {
        const loopAction = action as Action<"LOOP">;
        iterations[action.id] = loopAction.config.maxIterations || 100;
      }
    }

    return iterations;
  }

  /**
   * Suggest loop optimizations
   */
  suggestLoopOptimizations(workflow: Workflow): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const loopActions = this.getActionsByType(workflow, "LOOP");

    for (const loopAction of loopActions) {
      const analysis = this.analyzeLoopComplexity(workflow, loopAction.id);

      if (analysis.estimatedIterations > 50) {
        suggestions.push({
          type: "optimize_loop",
          priority: 4,
          actionIds: [loopAction.id],
          title: "Optimize high-iteration loop",
          description: `Loop may iterate ${analysis.estimatedIterations} times. Consider adding early exit conditions or reducing iterations.`,
          difficulty: 2,
        });
      }

      if (analysis.hasNestedLoops) {
        suggestions.push({
          type: "optimize_loop",
          priority: 5,
          actionIds: [loopAction.id],
          title: "Optimize nested loops",
          description: `Nested loops detected (depth: ${analysis.nestedDepth}). This can significantly impact performance.`,
          difficulty: 4,
        });
      }
    }

    return suggestions;
  }

  // ============================================================================
  // Resource Analysis
  // ============================================================================

  /**
   * Analyze resource usage
   */
  analyzeResourceUsage(workflow: Workflow): ResourceAnalysis {
    const screenshotActions = this.getActionsByType(workflow, "SCREENSHOT");
    const stateTransitionActions = this.getActionsByType(
      workflow,
      "GO_TO_STATE"
    );
    const heavyComputations: ResourceAnalysis["heavyComputations"] = [];
    const memoryIntensive: ResourceAnalysis["memoryIntensive"] = [];

    // Identify heavy computation actions
    for (const action of workflow.actions) {
      if (
        action.type === "MAP" ||
        action.type === "FILTER" ||
        action.type === "REDUCE"
      ) {
        heavyComputations.push({
          actionId: action.id,
          type: action.type,
          reason: "Data transformation operations can be CPU-intensive",
        });
      }

      if (action.type === "LOOP") {
        const loopAction = action as Action<"LOOP">;
        if ((loopAction.config.maxIterations || 0) > 100) {
          heavyComputations.push({
            actionId: action.id,
            type: action.type,
            reason: `High iteration count (${loopAction.config.maxIterations})`,
          });
        }
      }
    }

    // Identify memory-intensive operations
    if (screenshotActions.length > 10) {
      for (const action of screenshotActions) {
        memoryIntensive.push({
          actionId: action.id,
          type: action.type,
          reason: "Screenshots consume memory",
        });
      }
    }

    // Calculate resource score
    let resourceScore = 0;
    resourceScore += screenshotActions.length * 5;
    resourceScore += stateTransitionActions.length * 3;
    resourceScore += heavyComputations.length * 10;
    resourceScore += memoryIntensive.length * 8;
    resourceScore = Math.min(100, resourceScore);

    return {
      screenshotCount: screenshotActions.length,
      stateTransitionCount: stateTransitionActions.length,
      heavyComputations,
      memoryIntensive,
      resourceScore,
    };
  }

  // ============================================================================
  // Optimization Suggestions
  // ============================================================================

  /**
   * Generate optimization suggestions
   */
  generateSuggestions(
    workflow: Workflow,
    _executionData?: ExecutionData
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 1. Parallelization suggestions
    const parallelGroups = this.findParallelizableActions(workflow);
    for (const group of parallelGroups) {
      if (group.length >= 2) {
        const speedup = this.estimateParallelSpeedup(workflow, group);
        suggestions.push({
          type: "parallelize",
          priority: 5,
          actionIds: group,
          title: `Parallelize ${group.length} independent actions`,
          description: `These actions have no dependencies and can run simultaneously`,
          expectedSpeedup: `${speedup}ms`,
          difficulty: 2,
        });
      }
    }

    // 2. Wait replacement suggestions
    const unnecessaryWaits = this.getUnnecessaryWaits(workflow);
    for (const waitAction of unnecessaryWaits) {
      suggestions.push({
        type: "replace_wait",
        priority: 4,
        actionIds: [waitAction.id],
        title: "Replace fixed WAIT with dynamic condition",
        description:
          "This WAIT action uses a fixed duration. Consider using a FIND action or condition-based wait instead.",
        difficulty: 1,
      });
    }

    // 3. Loop optimization suggestions
    suggestions.push(...this.suggestLoopOptimizations(workflow));

    // 4. Screenshot reduction
    const screenshotCount = this.getActionsByType(
      workflow,
      "SCREENSHOT"
    ).length;
    if (screenshotCount > 5) {
      suggestions.push({
        type: "reduce_screenshots",
        priority: 3,
        actionIds: this.getActionsByType(workflow, "SCREENSHOT").map(
          (a) => a.id
        ),
        title: `Reduce number of screenshot operations`,
        description: `Workflow has ${screenshotCount} screenshot actions, which may impact performance`,
        difficulty: 2,
      });
    }

    // 5. Workflow splitting
    if (workflow.actions.length > 50) {
      suggestions.push({
        type: "split_workflow",
        priority: 3,
        actionIds: [],
        title: "Consider splitting into smaller workflows",
        description: `Workflow has ${workflow.actions.length} actions. Breaking it into smaller, focused workflows may improve maintainability and performance.`,
        difficulty: 4,
      });
    }

    // 6. Error handling
    const actionsWithoutErrorHandling = workflow.actions.filter(
      (a) => !this.hasErrorHandling(workflow, a.id)
    );
    if (actionsWithoutErrorHandling.length > workflow.actions.length * 0.5) {
      suggestions.push({
        type: "add_error_handling",
        priority: 3,
        actionIds: actionsWithoutErrorHandling.map((a) => a.id),
        title: "Add error handling",
        description:
          "Many actions lack error handling, which can cause delays during failures",
        difficulty: 3,
      });
    }

    // 7. Redundant operations
    const redundantGroups = this.getRedundantOperations(workflow);
    for (const group of redundantGroups) {
      suggestions.push({
        type: "remove_redundant",
        priority: 4,
        actionIds: group.map((a) => a.id),
        title: "Remove or cache redundant operations",
        description: `${group.length} actions have identical configurations. Consider caching or removing duplicates.`,
        difficulty: 2,
      });
    }

    // 8. Sequential FIND actions
    const findSequences = this.findSequentialFindActions(workflow);
    if (findSequences.length > 3) {
      suggestions.push({
        type: "parallelize",
        priority: 4,
        actionIds: findSequences,
        title: "Too many sequential FIND actions",
        description:
          "Multiple FIND actions in sequence can be slow. Consider restructuring or combining them.",
        difficulty: 3,
      });
    }

    // 9. Missing waits
    const waitAnalysis = this.analyzeWaitActions(workflow);
    for (const missing of waitAnalysis.missingWaits) {
      suggestions.push({
        type: "add_wait",
        priority: 2,
        actionIds: [missing.actionId],
        title: "Consider adding wait or find action",
        description: missing.reason,
        difficulty: 1,
      });
    }

    // Sort by priority
    suggestions.sort((a, b) => b.priority - a.priority);

    return suggestions;
  }

  /**
   * Suggest parallel branches
   */
  suggestParallelBranches(workflow: Workflow): Array<{
    actionIds: string[];
    reason: string;
  }> {
    const branches: Array<{ actionIds: string[]; reason: string }> = [];
    const parallelGroups = this.findParallelizableActions(workflow);

    for (const group of parallelGroups) {
      if (group.length >= 2) {
        branches.push({
          actionIds: group,
          reason: "These actions have no data dependencies",
        });
      }
    }

    return branches;
  }

  // ============================================================================
  // Performance Heatmap
  // ============================================================================

  /**
   * Generate performance heatmap data
   */
  generatePerformanceHeatmap(
    workflow: Workflow,
    executionData?: ExecutionData
  ): PerformanceHeatmap {
    const actionMetrics: PerformanceHeatmap["actionMetrics"] = {};
    let totalDuration = 0;
    let maxDuration = 0;
    let minDuration = Infinity;
    let count = 0;

    if (executionData) {
      // Use actual execution data
      for (const [_actionId, state] of Object.entries(
        executionData.actionStates
      )) {
        if (state.duration !== undefined) {
          totalDuration += state.duration;
          maxDuration = Math.max(maxDuration, state.duration);
          minDuration = Math.min(minDuration, state.duration);
          count++;
        }
      }

      const avgDuration = count > 0 ? totalDuration / count : 0;

      for (const [actionId, state] of Object.entries(
        executionData.actionStates
      )) {
        const duration = state.duration || 0;
        const ratio = avgDuration > 0 ? duration / avgDuration : 1;

        let status: "fast" | "normal" | "slow" | "critical";
        let color: string;

        if (ratio < 0.5) {
          status = "fast";
          color = "#10b981"; // green
        } else if (ratio < 1.5) {
          status = "normal";
          color = "#6b7280"; // gray
        } else if (ratio < 3) {
          status = "slow";
          color = "#f59e0b"; // orange
        } else {
          status = "critical";
          color = "#ef4444"; // red
        }

        const score = Math.max(0, Math.min(100, 100 - (ratio - 1) * 50));

        actionMetrics[actionId] = {
          score,
          duration,
          executionCount: state.executionCount || 1,
          status,
          color,
        };
      }
    } else {
      // Use estimated data
      for (const action of workflow.actions) {
        const estimatedDuration = this.estimateActionTime(action);
        totalDuration += estimatedDuration;
        maxDuration = Math.max(maxDuration, estimatedDuration);
        minDuration = Math.min(minDuration, estimatedDuration);
        count++;

        actionMetrics[action.id] = {
          score: 70, // Neutral score for estimates
          duration: estimatedDuration,
          status: "normal",
          color: "#6b7280",
        };
      }
    }

    return {
      actionMetrics,
      overall: {
        averageDuration: count > 0 ? totalDuration / count : 0,
        maxDuration: maxDuration === -Infinity ? 0 : maxDuration,
        minDuration: minDuration === Infinity ? 0 : minDuration,
      },
    };
  }

  // ============================================================================
  // Comparison
  // ============================================================================

  /**
   * Compare performance of two workflows
   */
  comparePerformance(
    workflow1: Workflow,
    workflow2: Workflow
  ): PerformanceComparison {
    const analysis1 = this.analyzePerformance(workflow1);
    const analysis2 = this.analyzePerformance(workflow2);

    const performanceScoreDelta =
      analysis2.performanceScore - analysis1.performanceScore;
    const executionTimeDelta =
      analysis2.estimatedExecutionTime - analysis1.estimatedExecutionTime;
    const bottleneckScoreDelta =
      analysis2.bottleneckScore - analysis1.bottleneckScore;
    const actionCountDelta =
      workflow2.actions.length - workflow1.actions.length;

    let winner: "workflow1" | "workflow2" | "tie";
    if (Math.abs(performanceScoreDelta) < 5) {
      winner = "tie";
    } else {
      winner = performanceScoreDelta > 0 ? "workflow2" : "workflow1";
    }

    const summary = this.generateComparisonSummary(
      performanceScoreDelta,
      executionTimeDelta,
      bottleneckScoreDelta,
      winner
    );

    return {
      workflow1: analysis1,
      workflow2: analysis2,
      differences: {
        performanceScoreDelta,
        executionTimeDelta,
        bottleneckScoreDelta,
        actionCountDelta,
      },
      summary,
      winner,
    };
  }

  /**
   * Track performance over time
   */
  trackPerformanceOverTime(
    workflowId: string,
    history: Array<{ version: string; executionData: ExecutionData }>
  ): Array<{
    version: string;
    performanceScore: number;
    executionTime: number;
    bottleneckScore: number;
  }> {
    return history.map(({ version, executionData }) => ({
      version,
      performanceScore:
        100 -
        this.getBottleneckScore({ id: workflowId } as Workflow, executionData),
      executionTime: executionData.totalDuration,
      bottleneckScore: this.getBottleneckScore(
        { id: workflowId } as Workflow,
        executionData
      ),
    }));
  }

  /**
   * Detect performance regression
   */
  detectPerformanceRegression(
    _workflowId: string,
    versions: Array<{
      version: string;
      workflow: Workflow;
      executionData?: ExecutionData;
    }>
  ): Array<{
    fromVersion: string;
    toVersion: string;
    regressionType: "execution_time" | "bottleneck_score" | "action_count";
    severity: "minor" | "moderate" | "severe";
    details: string;
  }> {
    const regressions: Array<{
      fromVersion: string;
      toVersion: string;
      regressionType: "execution_time" | "bottleneck_score" | "action_count";
      severity: "minor" | "moderate" | "severe";
      details: string;
    }> = [];

    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1];
      const curr = versions[i];
      if (!prev || !curr) continue;

      const prevAnalysis = this.analyzePerformance(
        prev.workflow,
        prev.executionData
      );
      const currAnalysis = this.analyzePerformance(
        curr.workflow,
        curr.executionData
      );

      // Check execution time regression
      const timeDelta =
        currAnalysis.estimatedExecutionTime -
        prevAnalysis.estimatedExecutionTime;
      const timeIncrease = timeDelta / prevAnalysis.estimatedExecutionTime;

      if (timeIncrease > 0.2) {
        regressions.push({
          fromVersion: prev.version,
          toVersion: curr.version,
          regressionType: "execution_time",
          severity:
            timeIncrease > 0.5
              ? "severe"
              : timeIncrease > 0.3
                ? "moderate"
                : "minor",
          details: `Execution time increased by ${Math.round(timeIncrease * 100)}% (${timeDelta}ms)`,
        });
      }

      // Check bottleneck score regression
      const bottleneckDelta =
        currAnalysis.bottleneckScore - prevAnalysis.bottleneckScore;
      if (bottleneckDelta > 15) {
        regressions.push({
          fromVersion: prev.version,
          toVersion: curr.version,
          regressionType: "bottleneck_score",
          severity:
            bottleneckDelta > 30
              ? "severe"
              : bottleneckDelta > 20
                ? "moderate"
                : "minor",
          details: `Bottleneck score increased by ${bottleneckDelta} points`,
        });
      }

      // Check action count increase
      const prevActionCount = prev.workflow.actions?.length ?? 0;
      const currActionCount = curr.workflow.actions?.length ?? 0;
      const actionDelta = currActionCount - prevActionCount;
      const actionIncrease =
        prevActionCount > 0 ? actionDelta / prevActionCount : 0;

      if (actionIncrease > 0.3) {
        regressions.push({
          fromVersion: prev.version,
          toVersion: curr.version,
          regressionType: "action_count",
          severity:
            actionIncrease > 0.6
              ? "severe"
              : actionIncrease > 0.4
                ? "moderate"
                : "minor",
          details: `Action count increased by ${Math.round(actionIncrease * 100)}% (${actionDelta} actions)`,
        });
      }
    }

    return regressions;
  }

  // ============================================================================
  // Reports
  // ============================================================================

  /**
   * Generate comprehensive performance report
   */
  generatePerformanceReport(
    workflow: Workflow,
    executionData?: ExecutionData
  ): string {
    const analysis = this.analyzePerformance(workflow, executionData);

    let report = "# Workflow Performance Analysis Report\n\n";
    report += `**Workflow:** ${workflow.name}\n`;
    report += `**Analysis Date:** ${analysis.timestamp.toLocaleString()}\n\n`;

    // Overall Metrics
    report += "## Overall Performance\n\n";
    report += `- **Performance Score:** ${analysis.performanceScore.toFixed(1)}/100\n`;
    report += `- **Bottleneck Score:** ${analysis.bottleneckScore.toFixed(1)}/100 ${analysis.bottleneckScore > 50 ? "⚠️" : "✓"}\n`;
    report += `- **Estimated Execution Time:** ${analysis.estimatedExecutionTime}ms\n`;
    if (analysis.actualExecutionTime) {
      report += `- **Actual Execution Time:** ${analysis.actualExecutionTime}ms\n`;
    }
    report += `- **Total Actions:** ${workflow.actions.length}\n\n`;

    // Bottlenecks
    if (analysis.bottlenecks.length > 0) {
      report += "## Identified Bottlenecks\n\n";
      for (const bottleneck of analysis.bottlenecks.slice(0, 5)) {
        report += `### ${bottleneck.type} (Severity: ${bottleneck.severity.toFixed(0)})\n\n`;
        report += `${bottleneck.description}\n\n`;
        report += `**Estimated Impact:** ${bottleneck.estimatedImpact}ms\n\n`;
        report += "**Suggestions:**\n";
        for (const suggestion of bottleneck.suggestions) {
          report += `- ${suggestion}\n`;
        }
        report += "\n";
      }
    } else {
      report +=
        "## Bottlenecks\n\nNo significant bottlenecks identified. ✓\n\n";
    }

    // Top Suggestions
    if (analysis.suggestions.length > 0) {
      report += "## Top Optimization Suggestions\n\n";
      for (const suggestion of analysis.suggestions.slice(0, 5)) {
        report += `### ${suggestion.title} (Priority: ${suggestion.priority}/5)\n\n`;
        report += `${suggestion.description}\n\n`;
        if (suggestion.expectedSpeedup) {
          report += `**Expected Speedup:** ${suggestion.expectedSpeedup}\n`;
        }
        if (suggestion.difficulty) {
          report += `**Implementation Difficulty:** ${suggestion.difficulty}/5\n`;
        }
        report += "\n";
      }
    }

    // Wait Analysis
    report += "## Wait Analysis\n\n";
    report += `- **Total Wait Time:** ${analysis.waitAnalysis.totalWaitTime}ms\n`;
    report += `- **Wait Actions:** ${analysis.waitAnalysis.waitCount}\n`;
    report += `- **Fixed Waits (could be dynamic):** ${analysis.waitAnalysis.fixedWaits.length}\n`;
    report += `- **Unnecessarily Long Waits:** ${analysis.waitAnalysis.longWaits.length}\n`;
    report += `- **Missing Waits:** ${analysis.waitAnalysis.missingWaits.length}\n\n`;

    // Loop Analysis
    if (analysis.loopAnalysis.loopCount > 0) {
      report += "## Loop Analysis\n\n";
      report += `- **Loop Actions:** ${analysis.loopAnalysis.loopCount}\n`;
      report += `- **Infinite Loop Risks:** ${analysis.loopAnalysis.infiniteLoopRisks.length}\n`;
      report += `- **Nested Loops:** ${analysis.loopAnalysis.nestedLoops.length}\n\n`;
    }

    // Resource Usage
    report += "## Resource Usage\n\n";
    report += `- **Screenshot Operations:** ${analysis.resourceAnalysis.screenshotCount}\n`;
    report += `- **State Transitions:** ${analysis.resourceAnalysis.stateTransitionCount}\n`;
    report += `- **Heavy Computations:** ${analysis.resourceAnalysis.heavyComputations.length}\n`;
    report += `- **Resource Usage Score:** ${analysis.resourceAnalysis.resourceScore.toFixed(0)}/100\n\n`;

    // Parallelization
    if (analysis.parallelizationOpportunities.length > 0) {
      report += "## Parallelization Opportunities\n\n";
      report += `Found ${analysis.parallelizationOpportunities.length} opportunities to parallelize actions:\n\n`;
      for (const opp of analysis.parallelizationOpportunities.slice(0, 3)) {
        const totalActions = opp.groups.reduce((sum, g) => sum + g.length, 0);
        report += `- ${totalActions} actions could run in parallel (estimated speedup: ${opp.estimatedSpeedup}ms)\n`;
      }
      report += "\n";
    }

    return report;
  }

  /**
   * Export optimization report
   */
  exportOptimizationReport(workflow: Workflow): {
    format: "json";
    data: PerformanceAnalysisResult;
  } {
    const analysis = this.analyzePerformance(workflow);
    return {
      format: "json",
      data: analysis,
    };
  }

  // ============================================================================
  // Persistence & Caching
  // ============================================================================

  /**
   * Cache analysis result
   */
  private cacheAnalysis(
    workflowId: string,
    result: PerformanceAnalysisResult
  ): void {
    this.cache.set(workflowId, {
      data: result,
      timestamp: Date.now(),
    });

    // Persist to localStorage
    try {
      const stored = this.loadStoredAnalyses();
      stored[workflowId] = result;
      localStorage.setItem(
        WorkflowPerformanceAnalyzer.STORAGE_KEY,
        JSON.stringify(stored)
      );
    } catch (error) {
      console.warn("Failed to persist analysis:", error);
    }
  }

  /**
   * Get cached analysis
   */
  private getCachedAnalysis(
    workflowId: string,
    executionData?: ExecutionData
  ): PerformanceAnalysisResult | null {
    // Don't use cache if we have new execution data
    if (executionData) {
      return null;
    }

    const cached = this.cache.get(workflowId);
    if (
      cached &&
      Date.now() - cached.timestamp < WorkflowPerformanceAnalyzer.CACHE_DURATION
    ) {
      return cached.data;
    }

    return null;
  }

  /**
   * Load stored analyses from localStorage
   */
  private loadStoredAnalyses(): Record<string, PerformanceAnalysisResult> {
    try {
      const stored = localStorage.getItem(
        WorkflowPerformanceAnalyzer.STORAGE_KEY
      );
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn("Failed to load stored analyses:", error);
      return {};
    }
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.cache.clear();
    try {
      localStorage.removeItem(WorkflowPerformanceAnalyzer.STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to clear stored analyses:", error);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Calculate overall performance score (0-100, higher is better)
   */
  private calculatePerformanceScore(
    workflow: Workflow,
    _executionData: ExecutionData | undefined,
    bottleneckScore: number
  ): number {
    let score = 100;

    // Deduct for bottlenecks
    score -= bottleneckScore * 0.4;

    // Deduct for complexity
    const actionCount = workflow.actions.length;
    score -= Math.min(20, actionCount / 10);

    // Deduct for waits
    const waitCount = this.countWaitActions(workflow);
    score -= Math.min(15, waitCount * 3);

    // Bonus for parallelization
    const parallelGroups = this.findParallelizableActions(workflow);
    const parallelRatio =
      parallelGroups.reduce((sum, g) => sum + g.length, 0) / actionCount;
    score += parallelRatio * 10;

    // Bonus for error handling
    const withErrorHandling = workflow.actions.filter((a) =>
      this.hasErrorHandling(workflow, a.id)
    ).length;
    const errorHandlingRatio = withErrorHandling / actionCount;
    score += errorHandlingRatio * 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get average action duration
   */
  private getAverageDuration(executionData: ExecutionData): number {
    const durations = Object.values(executionData.actionStates)
      .filter((s) => s.duration !== undefined)
      .map((s) => s.duration!);

    if (durations.length === 0) return 0;

    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(workflow: Workflow): Map<string, Set<string>> {
    const dependencies = new Map<string, Set<string>>();

    for (const action of workflow.actions) {
      dependencies.set(action.id, new Set());
    }

    // Analyze connections
    for (const [sourceId, outputs] of Object.entries(workflow.connections)) {
      for (const outputType of Object.values(outputs)) {
        if (!outputType) continue;
        for (const connections of outputType) {
          for (const conn of connections) {
            const deps = dependencies.get(conn.action) || new Set();
            deps.add(sourceId);
            dependencies.set(conn.action, deps);
          }
        }
      }
    }

    return dependencies;
  }

  /**
   * Find independent actions (no dependencies between them)
   */
  private findIndependentActions(
    workflow: Workflow,
    startActionId: string,
    dependencies: Map<string, Set<string>>,
    visited: Set<string>
  ): string[] {
    const independent: string[] = [startActionId];
    const startDeps = dependencies.get(startActionId) || new Set();

    for (const action of workflow.actions) {
      if (action.id === startActionId || visited.has(action.id)) continue;

      const actionDeps = dependencies.get(action.id) || new Set();

      // Check if actions have overlapping dependencies
      const hasOverlap = Array.from(startDeps).some((d) => actionDeps.has(d));

      // Check if actions depend on each other
      const dependsOnStart = actionDeps.has(startActionId);
      const startDependsOnAction = startDeps.has(action.id);

      if (!hasOverlap && !dependsOnStart && !startDependsOnAction) {
        independent.push(action.id);
      }
    }

    return independent.length > 1 ? independent : [];
  }

  /**
   * Find sequential operations that could be parallel
   */
  private findSequentialOperationsThatCouldBeParallel(
    workflow: Workflow
  ): string[][] {
    const groups: string[][] = [];
    const dependencies = this.buildDependencyGraph(workflow);

    // Find chains of actions
    const chains = this.findActionChains(workflow);

    for (const chain of chains) {
      // Look for consecutive actions in chain that could be parallel
      const independentGroup: string[] = [];

      for (let i = 0; i < chain.length; i++) {
        const actionId = chain[i];
        const nextId = chain[i + 1];

        if (!nextId) {
          if (independentGroup.length >= 2) {
            groups.push([...independentGroup]);
          }
          break;
        }

        const nextDeps = dependencies.get(nextId) || new Set();

        // If next action doesn't depend on current, they could be parallel
        if (!nextDeps.has(actionId ?? "")) {
          if (independentGroup.length === 0) {
            independentGroup.push(actionId ?? "");
          }
          independentGroup.push(nextId);
        } else {
          if (independentGroup.length >= 2) {
            groups.push([...independentGroup]);
          }
          independentGroup.length = 0;
        }
      }
    }

    return groups;
  }

  /**
   * Find action chains (sequential paths)
   */
  private findActionChains(workflow: Workflow): string[][] {
    const chains: string[][] = [];
    const visited = new Set<string>();

    // Find start actions (no incoming connections)
    const startActions = workflow.actions.filter((action) => {
      return !Object.values(workflow.connections).some((outputs) =>
        Object.values(outputs).some((outputType) =>
          outputType?.some((connections) =>
            connections.some((conn) => conn.action === action.id)
          )
        )
      );
    });

    for (const startAction of startActions) {
      if (visited.has(startAction.id)) continue;

      const chain: string[] = [];
      let current = startAction.id;

      while (current && !visited.has(current)) {
        chain.push(current);
        visited.add(current);

        // Get next action
        const outputs = workflow.connections[current];
        const mainConnections = outputs?.main?.[0];
        current = mainConnections?.[0]?.action || "";
      }

      if (chain.length > 1) {
        chains.push(chain);
      }
    }

    return chains;
  }

  /**
   * Get next actions
   */
  private getNextActions(workflow: Workflow, actionId: string): Action[] {
    const nextActions: Action[] = [];
    const outputs = workflow.connections[actionId];

    if (outputs) {
      for (const outputType of Object.values(outputs)) {
        if (!outputType) continue;
        for (const connections of outputType) {
          for (const conn of connections) {
            const action = workflow.actions.find((a) => a.id === conn.action);
            if (action) {
              nextActions.push(action);
            }
          }
        }
      }
    }

    return nextActions;
  }

  /**
   * Get previous actions
   */
  private getPreviousActions(workflow: Workflow, actionId: string): Action[] {
    const prevActions: Action[] = [];

    for (const [sourceId, outputs] of Object.entries(workflow.connections)) {
      for (const outputType of Object.values(outputs)) {
        if (!outputType) continue;
        for (const connections of outputType) {
          for (const conn of connections) {
            if (conn.action === actionId) {
              const action = workflow.actions.find((a) => a.id === sourceId);
              if (action) {
                prevActions.push(action);
              }
            }
          }
        }
      }
    }

    return prevActions;
  }

  /**
   * Find nested loops
   */
  private findNestedLoops(workflow: Workflow, loopActionId: string): string[] {
    const nestedLoops: string[] = [];

    // Get all actions within this loop
    const loopActions = this.getActionsInLoop(workflow, loopActionId);

    // Find LOOP actions within
    for (const actionId of loopActions) {
      const action = workflow.actions.find((a) => a.id === actionId);
      if (action?.type === "LOOP" && action.id !== loopActionId) {
        nestedLoops.push(action.id);
      }
    }

    return nestedLoops;
  }

  /**
   * Get all actions within a loop
   */
  private getActionsInLoop(workflow: Workflow, loopActionId: string): string[] {
    const actionsInLoop: string[] = [];
    const loopAction = workflow.actions.find((a) => a.id === loopActionId) as
      | Action<"LOOP">
      | undefined;

    if (!loopAction) return [];

    // For simplicity, assume loop body is defined in config
    // In reality, would need to traverse connections to find loop body
    // This is a placeholder implementation

    return actionsInLoop;
  }

  /**
   * Check if action has break
   */
  private hasBreakAction(workflow: Workflow, loopActionId: string): boolean {
    const actionsInLoop = this.getActionsInLoop(workflow, loopActionId);
    return actionsInLoop.some((actionId) => {
      const action = workflow.actions.find((a) => a.id === actionId);
      return action?.type === "BREAK";
    });
  }

  /**
   * Check if action has error handling
   */
  private hasErrorHandling(workflow: Workflow, actionId: string): boolean {
    // Check if action is in a TRY_CATCH
    for (const action of workflow.actions) {
      if (action.type === "TRY_CATCH") {
        // Would need to check if actionId is in try block
        // Placeholder implementation
        return true;
      }
    }

    // Check if action has error connections
    const outputs = workflow.connections[actionId];
    return !!outputs?.error && outputs.error.length > 0;
  }

  /**
   * Hash action config for comparison
   */
  private hashActionConfig(action: Action): string {
    return `${action.type}:${JSON.stringify(action.config)}`;
  }

  /**
   * Find sequential FIND actions
   */
  private findSequentialFindActions(workflow: Workflow): string[] {
    const findActions: string[] = [];
    const chains = this.findActionChains(workflow);

    for (const chain of chains) {
      let sequentialFinds: string[] = [];

      for (const actionId of chain) {
        const action = workflow.actions.find((a) => a.id === actionId);

        if (action && action.type === "FIND") {
          sequentialFinds.push(actionId);
        } else {
          if (sequentialFinds.length > 0) {
            findActions.push(...sequentialFinds);
            sequentialFinds = [];
          }
        }
      }

      if (sequentialFinds.length > 0) {
        findActions.push(...sequentialFinds);
      }
    }

    return findActions;
  }

  /**
   * Generate comparison summary
   */
  private generateComparisonSummary(
    performanceDelta: number,
    timeDelta: number,
    _bottleneckDelta: number,
    winner: "workflow1" | "workflow2" | "tie"
  ): string {
    if (winner === "tie") {
      return "Both workflows have similar performance characteristics.";
    }

    const betterWorkflow = winner === "workflow1" ? "First" : "Second";
    const performanceChange = Math.abs(performanceDelta).toFixed(1);
    const timeChange = Math.abs(timeDelta);

    return `${betterWorkflow} workflow performs better with ${performanceChange} point higher performance score and approximately ${timeChange}ms faster execution time.`;
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const workflowPerformanceAnalyzer = new WorkflowPerformanceAnalyzer();
