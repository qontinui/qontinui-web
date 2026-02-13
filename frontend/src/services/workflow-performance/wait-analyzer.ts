/**
 * Wait Analyzer
 *
 * Analyzes wait times, idle times, and missing wait/find patterns in workflows.
 * Also handles loop analysis and resource usage analysis.
 */

import type { Workflow, Action } from "@/lib/action-schema/action-types";
import type {
  WaitAnalysis,
  LoopAnalysis,
  ResourceAnalysis,
  OptimizationSuggestion,
} from "./types";
import {
  getActionsByType,
  getPreviousActions,
  findNestedLoops,
  analyzeLoopComplexity,
  hasBreakAction,
} from "./helpers";

export class WaitAnalyzer {
  // ============================================================================
  // Wait Analysis
  // ============================================================================

  /**
   * Analyze wait actions
   */
  analyzeWaitActions(workflow: Workflow): WaitAnalysis {
    // WAIT action type has been removed - return empty analysis
    const totalWaitTime = 0;
    const fixedWaits: WaitAnalysis["fixedWaits"] = [];
    const longWaits: WaitAnalysis["longWaits"] = [];
    const missingWaits: WaitAnalysis["missingWaits"] = [];
    const waitFindPatterns: WaitAnalysis["waitFindPatterns"] = [];

    // Find missing FIND actions before interactions
    for (const action of workflow.actions) {
      // Actions that might need FIND before them
      if (action.type === "CLICK" || action.type === "TYPE") {
        const prevActions = getPreviousActions(workflow, action.id);
        const hasFind = prevActions.some((a) => a.type === "FIND");

        if (!hasFind && prevActions.length > 0) {
          missingWaits.push({
            actionId: action.id,
            reason: `${action.type} action might need a FIND before it to ensure UI is ready`,
          });
        }
      }
    }

    return {
      totalWaitTime,
      waitCount: 0,
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
    const loopActions = getActionsByType(workflow, "LOOP");
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
      const nested = findNestedLoops(workflow, loopAction.id);
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
          !hasBreakAction(workflow, action.id)
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
    const loopActions = getActionsByType(workflow, "LOOP");

    for (const loopAction of loopActions) {
      const analysis = analyzeLoopComplexity(workflow, loopAction.id);

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
    const screenshotActions = getActionsByType(workflow, "SCREENSHOT");
    const stateTransitionActions = getActionsByType(workflow, "GO_TO_STATE");
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
}
