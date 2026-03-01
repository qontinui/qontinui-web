/**
 * Workflow Performance Helpers
 *
 * Shared utility functions used by multiple analyzer modules.
 */

import type {
  Workflow,
  Action,
  ActionType,
} from "@/lib/action-schema/action-types";
import { ACTION_TIME_ESTIMATES, type ExecutionData } from "./types";

// ============================================================================
// Action Utilities
// ============================================================================

/**
 * Get actions by type
 */
export function getActionsByType<T extends ActionType>(
  workflow: Workflow,
  actionType: T
): Action<T>[] {
  return workflow.actions.filter((a) => a.type === actionType) as Action<T>[];
}

/**
 * Estimate time for a single action
 */
export function estimateActionTime(action: Action): number {
  const baseTime = ACTION_TIME_ESTIMATES[action.type] || 100;

  // Adjust for specific configurations
  if (action.type === "LOOP") {
    const loopAction = action as Action<"LOOP">;
    const iterations = loopAction.config.maxIterations || 10;
    return baseTime * iterations;
  }

  return baseTime;
}

/**
 * Count WAIT actions (deprecated - WAIT action type removed)
 */
export function countWaitActions(_workflow: Workflow): number {
  return 0;
}

/**
 * Count FIND actions
 */
export function countFindActions(workflow: Workflow): number {
  return workflow.actions.filter((a) => a.type === "FIND").length;
}

/**
 * Estimate execution time based on action types
 */
export function estimateExecutionTime(workflow: Workflow): number {
  let totalTime = 0;

  for (const action of workflow.actions) {
    totalTime += estimateActionTime(action);
  }

  return totalTime;
}

// ============================================================================
// Dependency Graph
// ============================================================================

/**
 * Build dependency graph
 */
export function buildDependencyGraph(
  workflow: Workflow
): Map<string, Set<string>> {
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
export function findIndependentActions(
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

// ============================================================================
// Action Chain Analysis
// ============================================================================

/**
 * Find action chains (sequential paths)
 */
export function findActionChains(workflow: Workflow): string[][] {
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
 * Get previous actions
 */
export function getPreviousActions(
  workflow: Workflow,
  actionId: string
): Action[] {
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

// ============================================================================
// Loop Helpers
// ============================================================================

/**
 * Get all actions within a loop
 */
export function getActionsInLoop(
  workflow: Workflow,
  loopActionId: string
): string[] {
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
 * Find nested loops
 */
export function findNestedLoops(
  workflow: Workflow,
  loopActionId: string
): string[] {
  const nestedLoops: string[] = [];

  // Get all actions within this loop
  const loopActions = getActionsInLoop(workflow, loopActionId);

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
 * Analyze loop complexity
 */
export function analyzeLoopComplexity(
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
  const nested = findNestedLoops(workflow, loopActionId);

  return {
    estimatedIterations: maxIterations,
    hasNestedLoops: nested.length > 0,
    nestedDepth: nested.length,
  };
}

/**
 * Check if action has break
 */
export function hasBreakAction(
  workflow: Workflow,
  loopActionId: string
): boolean {
  const actionsInLoop = getActionsInLoop(workflow, loopActionId);
  return actionsInLoop.some((actionId) => {
    const action = workflow.actions.find((a) => a.id === actionId);
    return action?.type === "BREAK";
  });
}

// ============================================================================
// Error Handling Helpers
// ============================================================================

/**
 * Check if action has error handling
 */
export function hasErrorHandling(
  workflow: Workflow,
  actionId: string
): boolean {
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

// ============================================================================
// Execution Data Helpers
// ============================================================================

/**
 * Get average action duration from execution data
 */
export function getAverageDuration(executionData: ExecutionData): number {
  const durations = Object.values(executionData.actionStates)
    .filter((s) => s.duration !== undefined)
    .map((s) => s.duration!);

  if (durations.length === 0) return 0;

  return durations.reduce((sum, d) => sum + d, 0) / durations.length;
}

/**
 * Get action timings from execution data
 */
export function getActionTimings(
  executionData: ExecutionData
): Record<string, number> {
  const timings: Record<string, number> = {};

  for (const [actionId, state] of Object.entries(executionData.actionStates)) {
    if (state.duration !== undefined) {
      timings[actionId] = state.duration;
    }
  }

  return timings;
}

// ============================================================================
// Misc Helpers
// ============================================================================

/**
 * Hash action config for comparison
 */
export function hashActionConfig(action: Action): string {
  return `${action.type}:${JSON.stringify(action.config)}`;
}

/**
 * Find sequential FIND actions
 */
export function findSequentialFindActions(workflow: Workflow): string[] {
  const findActions: string[] = [];
  const chains = findActionChains(workflow);

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
