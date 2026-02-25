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
import type {
  ExecutionData,
  PerformanceBottleneck,
  OptimizationSuggestion,
  ParallelizationOpportunity,
  WaitAnalysis,
  LoopAnalysis,
  ResourceAnalysis,
  PerformanceHeatmap,
  PerformanceAnalysisResult,
  PerformanceComparison,
} from "./types";
import { BottleneckAnalyzer } from "./bottleneck-analyzer";
import { ParallelizationAnalyzer } from "./parallelization-analyzer";
import { WaitAnalyzer } from "./wait-analyzer";
import { HeatmapGenerator } from "./heatmap-generator";
import { SuggestionGenerator } from "./suggestion-generator";
import {
  getActionsByType,
  countWaitActions,
  countFindActions,
  estimateExecutionTime,
  analyzeLoopComplexity,
  hasErrorHandling,
  getActionTimings,
} from "./helpers";
import { createLogger } from "@/lib/logger";
const logger = createLogger("WorkflowPerformance");

// Re-export all types
export type {
  ExecutionData,
  PerformanceBottleneck,
  OptimizationSuggestion,
  ParallelizationOpportunity,
  WaitAnalysis,
  LoopAnalysis,
  ResourceAnalysis,
  PerformanceHeatmap,
  PerformanceAnalysisResult,
  PerformanceComparison,
} from "./types";

// Re-export constants
export { ACTION_TIME_ESTIMATES } from "./types";

// Re-export sub-analyzers for direct use
export { BottleneckAnalyzer } from "./bottleneck-analyzer";
export { ParallelizationAnalyzer } from "./parallelization-analyzer";
export { WaitAnalyzer } from "./wait-analyzer";
export { HeatmapGenerator } from "./heatmap-generator";
export { SuggestionGenerator } from "./suggestion-generator";

// Re-export helpers for external use
export {
  getActionsByType,
  estimateActionTime,
  countWaitActions,
  countFindActions,
  estimateExecutionTime,
  buildDependencyGraph,
  findIndependentActions,
  findActionChains,
  getPreviousActions,
  getActionsInLoop,
  findNestedLoops,
  analyzeLoopComplexity,
  hasBreakAction,
  hasErrorHandling,
  getAverageDuration,
  getActionTimings,
  hashActionConfig,
  findSequentialFindActions,
} from "./helpers";

// ============================================================================
// Performance Analyzer Service (Facade)
// ============================================================================

export class WorkflowPerformanceAnalyzer {
  private static readonly STORAGE_KEY = "workflow-performance-analysis";
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private cache: Map<
    string,
    { data: PerformanceAnalysisResult; timestamp: number }
  > = new Map();

  private readonly bottleneckAnalyzer = new BottleneckAnalyzer();
  private readonly parallelizationAnalyzer = new ParallelizationAnalyzer();
  private readonly waitAnalyzer = new WaitAnalyzer();
  private readonly heatmapGenerator = new HeatmapGenerator();
  private readonly suggestionGenerator = new SuggestionGenerator();

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
    const bottlenecks = this.bottleneckAnalyzer.identifyBottlenecks(
      workflow,
      executionData
    );
    const waitAnalysis = this.waitAnalyzer.analyzeWaitActions(workflow);
    const loopAnalysis = this.waitAnalyzer.analyzeLoops(workflow);
    const resourceAnalysis = this.waitAnalyzer.analyzeResourceUsage(workflow);
    const parallelizationOpportunities =
      this.parallelizationAnalyzer.analyzeParallelizationOpportunities(
        workflow
      );
    const suggestions = this.generateSuggestions(workflow, executionData);

    const estimatedTime = estimateExecutionTime(workflow);
    const actualExecutionTime = executionData?.totalDuration;
    const actionTimings = executionData
      ? getActionTimings(executionData)
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
    const heatmap = this.heatmapGenerator.generatePerformanceHeatmap(
      workflow,
      executionData
    );

    const result: PerformanceAnalysisResult = {
      performanceScore,
      bottleneckScore,
      estimatedExecutionTime: estimatedTime,
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

  // ============================================================================
  // Delegated Methods (preserve original API surface)
  // ============================================================================

  /**
   * Identify bottlenecks in workflow
   */
  identifyBottlenecks(
    workflow: Workflow,
    executionData?: ExecutionData
  ): PerformanceBottleneck[] {
    return this.bottleneckAnalyzer.identifyBottlenecks(workflow, executionData);
  }

  /**
   * Get slowest actions from execution data
   */
  getSlowestActions(
    workflow: Workflow,
    executionData: ExecutionData,
    limit: number = 10
  ): Array<{ actionId: string; duration: number }> {
    return this.bottleneckAnalyzer.getSlowestActions(
      workflow,
      executionData,
      limit
    );
  }

  /**
   * Get unnecessary wait actions
   */
  getUnnecessaryWaits(workflow: Workflow): Action[] {
    return this.bottleneckAnalyzer.getUnnecessaryWaits(workflow);
  }

  /**
   * Get redundant operations
   */
  getRedundantOperations(workflow: Workflow): Action[][] {
    return this.bottleneckAnalyzer.getRedundantOperations(workflow);
  }

  /**
   * Analyze parallelization opportunities
   */
  analyzeParallelizationOpportunities(
    workflow: Workflow
  ): ParallelizationOpportunity[] {
    return this.parallelizationAnalyzer.analyzeParallelizationOpportunities(
      workflow
    );
  }

  /**
   * Find groups of actions that can be parallelized
   */
  findParallelizableActions(workflow: Workflow): string[][] {
    return this.parallelizationAnalyzer.findParallelizableActions(workflow);
  }

  /**
   * Validate if actions can be parallelized
   */
  validateParallelization(
    workflow: Workflow,
    actionIds: string[]
  ): { valid: boolean; issues: string[] } {
    return this.parallelizationAnalyzer.validateParallelization(
      workflow,
      actionIds
    );
  }

  /**
   * Estimate speedup from parallelization
   */
  estimateParallelSpeedup(
    workflow: Workflow,
    parallelActionIds: string[]
  ): number {
    return this.parallelizationAnalyzer.estimateParallelSpeedup(
      workflow,
      parallelActionIds
    );
  }

  /**
   * Suggest parallel branches
   */
  suggestParallelBranches(workflow: Workflow): Array<{
    actionIds: string[];
    reason: string;
  }> {
    return this.parallelizationAnalyzer.suggestParallelBranches(workflow);
  }

  /**
   * Analyze wait actions
   */
  analyzeWaitActions(workflow: Workflow): WaitAnalysis {
    return this.waitAnalyzer.analyzeWaitActions(workflow);
  }

  /**
   * Analyze loops in workflow
   */
  analyzeLoops(workflow: Workflow): LoopAnalysis {
    return this.waitAnalyzer.analyzeLoops(workflow);
  }

  /**
   * Detect potential infinite loops
   */
  detectInfiniteLoops(workflow: Workflow): string[] {
    return this.waitAnalyzer.detectInfiniteLoops(workflow);
  }

  /**
   * Estimate loop iterations
   */
  estimateLoopIterations(workflow: Workflow): Record<string, number> {
    return this.waitAnalyzer.estimateLoopIterations(workflow);
  }

  /**
   * Suggest loop optimizations
   */
  suggestLoopOptimizations(workflow: Workflow): OptimizationSuggestion[] {
    return this.waitAnalyzer.suggestLoopOptimizations(workflow);
  }

  /**
   * Analyze resource usage
   */
  analyzeResourceUsage(workflow: Workflow): ResourceAnalysis {
    return this.waitAnalyzer.analyzeResourceUsage(workflow);
  }

  /**
   * Generate performance heatmap data
   */
  generatePerformanceHeatmap(
    workflow: Workflow,
    executionData?: ExecutionData
  ): PerformanceHeatmap {
    return this.heatmapGenerator.generatePerformanceHeatmap(
      workflow,
      executionData
    );
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
    return getActionTimings(executionData);
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
    const timings = getActionTimings(executionData);

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
    const parallelizableGroups =
      this.parallelizationAnalyzer.findParallelizableActions(workflow);
    const parallelizableCount = parallelizableGroups.reduce(
      (sum, g) => sum + g.length,
      0
    );
    const sequentialRatio = (actionCount - parallelizableCount) / actionCount;
    score += sequentialRatio * 30;

    // Factor 3: Wait actions
    const waitCount = countWaitActions(workflow);
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
  // Static Analysis (delegated helper wrappers)
  // ============================================================================

  /**
   * Estimate execution time based on action types
   */
  estimateExecutionTime(workflow: Workflow): number {
    return estimateExecutionTime(workflow);
  }

  /**
   * Count WAIT actions
   */
  countWaitActions(workflow: Workflow): number {
    return countWaitActions(workflow);
  }

  /**
   * Count FIND actions
   */
  countFindActions(workflow: Workflow): number {
    return countFindActions(workflow);
  }

  /**
   * Get actions by type
   */
  getActionsByType<T extends ActionType>(
    workflow: Workflow,
    actionType: T
  ): Action<T>[] {
    return getActionsByType(workflow, actionType);
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
    return analyzeLoopComplexity(workflow, loopActionId);
  }

  // ============================================================================
  // Optimization Suggestions
  // ============================================================================

  /**
   * Generate optimization suggestions
   */
  generateSuggestions(
    workflow: Workflow,
    executionData?: ExecutionData
  ): OptimizationSuggestion[] {
    return this.suggestionGenerator.generateSuggestions(
      workflow,
      executionData
    );
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
      logger.warn("Failed to persist analysis:", error);
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
      logger.warn("Failed to load stored analyses:", error);
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
      logger.warn("Failed to clear stored analyses:", error);
    }
  }

  // ============================================================================
  // Private Helper Methods
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
    const waitCount = countWaitActions(workflow);
    score -= Math.min(15, waitCount * 3);

    // Bonus for parallelization
    const parallelGroups =
      this.parallelizationAnalyzer.findParallelizableActions(workflow);
    const parallelRatio =
      parallelGroups.reduce((sum, g) => sum + g.length, 0) / actionCount;
    score += parallelRatio * 10;

    // Bonus for error handling
    const withErrorHandling = workflow.actions.filter((a) =>
      hasErrorHandling(workflow, a.id)
    ).length;
    const errorHandlingRatio = withErrorHandling / actionCount;
    score += errorHandlingRatio * 10;

    return Math.max(0, Math.min(100, score));
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
