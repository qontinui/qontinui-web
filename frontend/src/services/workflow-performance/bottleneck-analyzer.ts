/**
 * Bottleneck Analyzer
 *
 * Identifies performance bottlenecks in workflows including slow actions,
 * unnecessary waits, sequential operations, loop issues, and resource-intensive operations.
 */

import type { Workflow, Action } from "@/lib/action-schema/action-types";
import type { ExecutionData, PerformanceBottleneck } from "./types";
import {
  getActionsByType,
  estimateActionTime,
  buildDependencyGraph,
  findActionChains,
  analyzeLoopComplexity,
  getAverageDuration,
  hashActionConfig,
} from "./helpers";

export class BottleneckAnalyzer {
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
      const avgDuration = getAverageDuration(executionData);

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

    // 2. Unnecessary waits (deprecated - WAIT action type removed)
    // This section is kept for backward compatibility but does nothing
    const unnecessaryWaits = this.getUnnecessaryWaits(workflow);
    if (unnecessaryWaits.length > 0) {
      // Should never reach here since getUnnecessaryWaits returns empty array
      bottlenecks.push({
        type: "unnecessary_wait",
        severity: 0,
        actionIds: [],
        description: `Deprecated bottleneck type - WAIT action no longer exists`,
        estimatedImpact: 0,
        suggestions: [],
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
    const loopActions = getActionsByType(workflow, "LOOP");
    for (const loopAction of loopActions) {
      const loopComplexity = analyzeLoopComplexity(workflow, loopAction.id);
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
    const screenshotActions = getActionsByType(workflow, "SCREENSHOT");
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
  getUnnecessaryWaits(_workflow: Workflow): Action[] {
    // No WAIT action type exists anymore - this method is now deprecated
    // Keeping for backward compatibility but returns empty array
    return [];
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

      const configHash = hashActionConfig(action);
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
   * Estimate speedup from parallelization
   */
  private estimateParallelSpeedup(
    workflow: Workflow,
    parallelActionIds: string[]
  ): number {
    let totalSequentialTime = 0;

    for (const actionId of parallelActionIds) {
      const action = workflow.actions.find((a) => a.id === actionId);
      if (action) {
        totalSequentialTime += estimateActionTime(action);
      }
    }

    // Assume parallel execution takes as long as the longest action
    const longestTime = Math.max(
      ...parallelActionIds.map((id) => {
        const action = workflow.actions.find((a) => a.id === id);
        return action ? estimateActionTime(action) : 0;
      })
    );

    return totalSequentialTime - longestTime;
  }

  /**
   * Find sequential operations that could be parallel
   */
  private findSequentialOperationsThatCouldBeParallel(
    workflow: Workflow
  ): string[][] {
    const groups: string[][] = [];
    const dependencies = buildDependencyGraph(workflow);

    // Find chains of actions
    const chains = findActionChains(workflow);

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
}
