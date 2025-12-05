/**
 * Workflow Connection Validator
 *
 * Validates workflow connections for graph execution, checking:
 * - Connection indices validity
 * - Unreachable actions
 * - Cycles (warnings)
 * - Parallel branch safety
 * - Empty connections
 */

import { Workflow } from "./export-schema";

export interface WorkflowValidationError {
  type: "error" | "warning";
  message: string;
  actionId?: string;
  connectionType?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
  warnings: WorkflowValidationError[];
}

/**
 * Validate workflow connections
 */
export function validateWorkflowConnections(
  workflow: Workflow
): WorkflowValidationResult {
  const errors: WorkflowValidationError[] = [];
  const warnings: WorkflowValidationError[] = [];

  if (!workflow.actions || workflow.actions.length === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [{ type: "warning", message: "Workflow has no actions" }],
    };
  }

  // Build action index map
  const actionIndexMap = new Map<string, number>();
  workflow.actions.forEach((action, index) => {
    // Skip null/undefined actions
    if (action && action.id) {
      actionIndexMap.set(action.id, index);
    }
  });

  // 1. Check all connection indices are valid
  validateConnectionIndices(workflow, actionIndexMap, errors);

  // 2. Detect unreachable actions
  detectUnreachableActions(workflow, actionIndexMap, warnings);

  // 3. Detect cycles (warn, not error)
  detectCycles(workflow, actionIndexMap, warnings);

  // 4. Warn if no connections (will use sequential execution)
  if (!workflow.connections || Object.keys(workflow.connections).length === 0) {
    warnings.push({
      type: "warning",
      message: "No connections defined - workflow will execute sequentially",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate that all connection indices point to valid actions
 */
function validateConnectionIndices(
  workflow: Workflow,
  actionIndexMap: Map<string, number>,
  errors: WorkflowValidationError[]
): void {
  const maxIndex = workflow.actions.length - 1;

  Object.entries(workflow.connections).forEach(([actionId, outputs]) => {
    // Check that the action ID exists
    if (!actionIndexMap.has(actionId)) {
      errors.push({
        type: "error",
        message: `Connection references non-existent action ID: ${actionId}`,
        actionId,
      });
      return;
    }

    // Check all output paths
    ["main", "success", "error", "parallel"].forEach((outputType) => {
      const connections = outputs[outputType as keyof typeof outputs];
      if (!connections) return;

      connections.forEach((outputArray) => {
        outputArray.forEach((targetIndex) => {
          if (targetIndex < 0 || targetIndex > maxIndex) {
            errors.push({
              type: "error",
              message: `Invalid connection index ${targetIndex} (valid range: 0-${maxIndex})`,
              actionId,
              connectionType: outputType,
            });
          }
        });
      });
    });
  });
}

/**
 * Detect actions that are unreachable from the workflow start
 */
function detectUnreachableActions(
  workflow: Workflow,
  _actionIndexMap: Map<string, number>,
  warnings: WorkflowValidationError[]
): void {
  const reachable = new Set<number>();
  const visited = new Set<number>();

  // Start from action 0 (entry point)
  const queue: number[] = [0];
  reachable.add(0);

  while (queue.length > 0) {
    const currentIndex = queue.shift()!;
    if (visited.has(currentIndex)) continue;
    visited.add(currentIndex);

    const action = workflow.actions[currentIndex];
    if (!action || !action.id) continue;
    const connections = workflow.connections[action.id];

    if (!connections) continue;

    // Follow all connection paths
    ["main", "success", "error", "parallel"].forEach((outputType) => {
      const outputs = connections[outputType as keyof typeof connections];
      if (!outputs) return;

      outputs.forEach((outputArray) => {
        outputArray.forEach((targetIndex) => {
          if (!reachable.has(targetIndex)) {
            reachable.add(targetIndex);
            queue.push(targetIndex);
          }
        });
      });
    });
  }

  // Find unreachable actions (skip index 0 as it's the entry point)
  workflow.actions.forEach((action, index) => {
    if (index > 0 && !reachable.has(index)) {
      warnings.push({
        type: "warning",
        message: `Action "${action.name || action.id}" is unreachable from workflow start`,
        actionId: action.id,
      });
    }
  });
}

/**
 * Detect cycles in the workflow graph
 */
function detectCycles(
  workflow: Workflow,
  _actionIndexMap: Map<string, number>,
  warnings: WorkflowValidationError[]
): void {
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  const cycleDetected = new Set<number>();

  function hasCycle(index: number, path: number[]): boolean {
    visited.add(index);
    recursionStack.add(index);

    const action = workflow.actions[index];
    if (!action || !action.id) {
      recursionStack.delete(index);
      return false;
    }
    const connections = workflow.connections[action.id];

    if (connections) {
      ["main", "success", "error", "parallel"].forEach((outputType) => {
        const outputs = connections[outputType as keyof typeof connections];
        if (!outputs) return;

        outputs.forEach((outputArray) => {
          outputArray.forEach((targetIndex) => {
            if (!visited.has(targetIndex)) {
              if (hasCycle(targetIndex, [...path, targetIndex])) {
                cycleDetected.add(index);
                return true;
              }
            } else if (recursionStack.has(targetIndex)) {
              // Cycle detected
              cycleDetected.add(index);
              cycleDetected.add(targetIndex);
              return true;
            }
          });
        });
      });
    }

    recursionStack.delete(index);
    return false;
  }

  // Check for cycles starting from action 0
  hasCycle(0, [0]);

  if (cycleDetected.size > 0) {
    const cycleActions = Array.from(cycleDetected)
      .map(
        (index) => workflow.actions[index].name || workflow.actions[index].id
      )
      .join(", ");

    warnings.push({
      type: "warning",
      message: `Cycle detected in workflow graph involving actions: ${cycleActions}. Ensure proper exit conditions to avoid infinite loops.`,
    });
  }
}

/**
 * Check if workflow has conditional branching (success/error paths)
 */
export function hasConditionalLogic(workflow: Workflow): boolean {
  return Object.values(workflow.connections).some(
    (outputs) => outputs.success || outputs.error
  );
}

/**
 * Check if workflow has loops (cycles)
 */
export function hasLoops(workflow: Workflow): boolean {
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  function hasCycle(index: number): boolean {
    visited.add(index);
    recursionStack.add(index);

    const action = workflow.actions[index];
    const connections = workflow.connections[action.id];

    if (connections) {
      for (const outputType of [
        "main",
        "success",
        "error",
        "parallel",
      ] as const) {
        const outputs = connections[outputType];
        if (!outputs) continue;

        for (const outputArray of outputs) {
          for (const targetIndex of outputArray) {
            if (!visited.has(targetIndex)) {
              if (hasCycle(targetIndex)) {
                return true;
              }
            } else if (recursionStack.has(targetIndex)) {
              return true;
            }
          }
        }
      }
    }

    recursionStack.delete(index);
    return false;
  }

  return workflow.actions.some((_, index) => {
    if (!visited.has(index)) {
      return hasCycle(index);
    }
    return false;
  });
}
