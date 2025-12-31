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

import { Workflow, Action } from "./export-schema";

/**
 * Get a human-readable display name for an action
 */
function getActionDisplayName(action: Action | undefined): string {
  if (!action) return "Unknown action";
  if (action.name) return action.name;
  // Format type as readable name (e.g., "FIND" -> "Find", "MOUSE_MOVE" -> "Mouse Move")
  return action.type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

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

  // 5. Validate action configurations
  validateActionConfigs(workflow, errors);

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
        message: `Connection references non-existent action`,
        actionId,
      });
      return;
    }

    // Get action name for error messages
    const actionIndex = actionIndexMap.get(actionId)!;
    const action = workflow.actions[actionIndex];
    const actionName = getActionDisplayName(action);

    // Check all output paths
    ["main", "success", "error", "parallel"].forEach((outputType) => {
      const connections = outputs[outputType as keyof typeof outputs];
      if (!connections) return;

      connections.forEach((outputArray) => {
        outputArray.forEach((conn) => {
          if (conn.index < 0 || conn.index > maxIndex) {
            errors.push({
              type: "error",
              message: `Action "${actionName}" has invalid connection (index ${conn.index} out of range)`,
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
  // If workflow has no connections or is sequential, all actions are reachable
  // (they execute in array order)
  const hasConnections =
    workflow.connections && Object.keys(workflow.connections).length > 0;
  const isSequential = workflow.metadata?.viewMode === "sequential";

  if (!hasConnections || isSequential) {
    // Sequential workflows execute all actions in order - all are reachable
    return;
  }

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

    if (!connections) {
      // No explicit connections from this action - assume it continues to next action
      // (implicit sequential flow within graph workflows)
      const nextIndex = currentIndex + 1;
      if (nextIndex < workflow.actions.length && !reachable.has(nextIndex)) {
        reachable.add(nextIndex);
        queue.push(nextIndex);
      }
      continue;
    }

    // Follow all connection paths
    ["main", "success", "error", "parallel"].forEach((outputType) => {
      const outputs = connections[outputType as keyof typeof connections];
      if (!outputs) return;

      outputs.forEach((outputArray) => {
        outputArray.forEach((conn) => {
          // Find the target action index
          const targetAction = workflow.actions.find(
            (a) => a.id === conn.action
          );
          if (targetAction) {
            const targetIndex = workflow.actions.indexOf(targetAction);
            if (!reachable.has(targetIndex)) {
              reachable.add(targetIndex);
              queue.push(targetIndex);
            }
          }
        });
      });
    });

    // If this action has connections but none lead anywhere, also check implicit next
    const hasAnyOutput = ["main", "success", "error", "parallel"].some(
      (t) => connections[t as keyof typeof connections]?.length
    );
    if (!hasAnyOutput) {
      const nextIndex = currentIndex + 1;
      if (nextIndex < workflow.actions.length && !reachable.has(nextIndex)) {
        reachable.add(nextIndex);
        queue.push(nextIndex);
      }
    }
  }

  // Find unreachable actions (skip index 0 as it's the entry point)
  workflow.actions.forEach((action, index) => {
    if (index > 0 && !reachable.has(index)) {
      warnings.push({
        type: "warning",
        message: `Action "${getActionDisplayName(action)}" is unreachable from workflow start`,
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
      let foundCycle = false;
      ["main", "success", "error", "parallel"].forEach((outputType) => {
        const outputs = connections[outputType as keyof typeof connections];
        if (!outputs) return;

        outputs.forEach((outputArray) => {
          outputArray.forEach((conn) => {
            // Find the target action index
            const targetAction = workflow.actions.find(
              (a) => a.id === conn.action
            );
            if (!targetAction) return;
            const targetIndex = workflow.actions.indexOf(targetAction);

            if (!visited.has(targetIndex)) {
              if (hasCycle(targetIndex, [...path, targetIndex])) {
                cycleDetected.add(index);
                foundCycle = true;
              }
            } else if (recursionStack.has(targetIndex)) {
              // Cycle detected
              cycleDetected.add(index);
              cycleDetected.add(targetIndex);
              foundCycle = true;
            }
          });
        });
      });

      if (foundCycle) {
        recursionStack.delete(index);
        return true;
      }
    }

    recursionStack.delete(index);
    return false;
  }

  // Check for cycles starting from action 0
  hasCycle(0, [0]);

  if (cycleDetected.size > 0) {
    const cycleActions = Array.from(cycleDetected)
      .map((index) => {
        const action = workflow.actions[index];
        return getActionDisplayName(action);
      })
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
    if (!action) {
      recursionStack.delete(index);
      return false;
    }

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
          for (const conn of outputArray) {
            // Find the target action index
            const targetAction = workflow.actions.find(
              (a) => a.id === conn.action
            );
            if (!targetAction) continue;
            const targetIndex = workflow.actions.indexOf(targetAction);

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

/**
 * Validate action configurations for completeness
 */
function validateActionConfigs(
  workflow: Workflow,
  errors: WorkflowValidationError[]
): void {
  for (const action of workflow.actions) {
    if (!action || !action.config) continue;

    const actionName = getActionDisplayName(action);
    const config = action.config as Record<string, unknown>;

    // Validate IF actions
    if (action.type === "IF") {
      const condition = config.condition as Record<string, unknown> | undefined;
      if (condition) {
        const conditionType = condition.type as string | undefined;
        const imageId = condition.imageId as string | undefined;

        // Check image-based conditions have an image selected
        // Note: imageId can be undefined, null, or empty string "" when not selected
        if (
          (conditionType === "image_exists" ||
            conditionType === "image_vanished") &&
          (!imageId || imageId.trim() === "")
        ) {
          errors.push({
            type: "error",
            message: `Action "${actionName}" has condition "${formatConditionType(conditionType)}" but no image selected`,
            actionId: action.id,
          });
        }

        // Check text-based conditions have text specified
        if (conditionType === "text_exists" && !condition.text) {
          errors.push({
            type: "error",
            message: `Action "${actionName}" has condition "Text Exists" but no text specified`,
            actionId: action.id,
          });
        }

        // Check variable conditions have a variable name
        if (conditionType === "variable" && !condition.variableName) {
          errors.push({
            type: "error",
            message: `Action "${actionName}" has condition "Variable" but no variable name specified`,
            actionId: action.id,
          });
        }

        // Check expression conditions have an expression
        if (conditionType === "expression" && !condition.expression) {
          errors.push({
            type: "error",
            message: `Action "${actionName}" has condition "Expression" but no expression specified`,
            actionId: action.id,
          });
        }
      }
    }

    // Validate FIND actions have a target
    if (action.type === "FIND") {
      const target = config.target as Record<string, unknown> | undefined;
      if (!target || !target.type) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has no target configured`,
          actionId: action.id,
        });
      } else {
        validateTargetConfig(target, actionName, action.id, errors);
      }
    }

    // Note: CLICK and DRAG action config validation is handled by project-validator.ts
    // with category "action_config". This file focuses on workflow connection/structure issues.

    // Validate LOOP actions with conditions
    if (action.type === "LOOP") {
      const loopType = config.loopType as string | undefined;
      if (loopType === "WHILE") {
        const condition = config.condition as
          | Record<string, unknown>
          | undefined;
        if (condition) {
          const conditionType = condition.type as string | undefined;
          const imageId = condition.imageId as string | undefined;
          if (
            (conditionType === "image_exists" ||
              conditionType === "image_vanished") &&
            (!imageId || imageId.trim() === "")
          ) {
            errors.push({
              type: "error",
              message: `Action "${actionName}" has WHILE condition "${formatConditionType(conditionType)}" but no image selected`,
              actionId: action.id,
            });
          }
        }
      }
    }
  }
}

/**
 * Format condition type for display
 */
function formatConditionType(type: string): string {
  switch (type) {
    case "image_exists":
      return "Image Exists";
    case "image_vanished":
      return "Image Vanished";
    case "text_exists":
      return "Text Exists";
    case "variable":
      return "Variable";
    case "expression":
      return "Expression";
    default:
      return type;
  }
}

/**
 * Validate target configuration for completeness
 */
function validateTargetConfig(
  target: Record<string, unknown>,
  actionName: string,
  actionId: string,
  errors: WorkflowValidationError[]
): void {
  const targetType = target.type as string;

  // These target types don't require additional configuration
  const selfContainedTypes = [
    "lastFindResult",
    "currentPosition",
    "allResults",
  ];
  if (selfContainedTypes.includes(targetType)) {
    return; // Valid as-is
  }

  switch (targetType) {
    case "image":
      // Check for imageId (single) or imageIds (array)
      const imageId = target.imageId as string | undefined;
      const imageIds = target.imageIds as string[] | undefined;
      if (!imageId && (!imageIds || imageIds.length === 0)) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "Image" but no image selected`,
          actionId,
        });
      }
      break;

    case "stateImage":
      // Check for stateId or imageIds
      const stateId = target.stateId as string | undefined;
      const stateImageIds = target.imageIds as string[] | undefined;
      if (!stateId && (!stateImageIds || stateImageIds.length === 0)) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "State Image" but no state selected`,
          actionId,
        });
      }
      break;

    case "text":
      if (!target.text) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "Text" but no text specified`,
          actionId,
        });
      }
      break;

    case "coordinates":
      if (!target.coordinates) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "Coordinates" but no coordinates specified`,
          actionId,
        });
      }
      break;

    case "region":
      if (!target.region) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "Region" but no region specified`,
          actionId,
        });
      }
      break;

    case "resultIndex":
      if (target.index === undefined || target.index === null) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "Result Index" but no index specified`,
          actionId,
        });
      }
      break;

    case "resultByImage":
      if (!target.imageId) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "Result By Image" but no image specified`,
          actionId,
        });
      }
      break;

    case "stateString":
      const stringStateId = target.stateId as string | undefined;
      const stringIds = target.stringIds as string[] | undefined;
      if (!stringStateId && (!stringIds || stringIds.length === 0)) {
        errors.push({
          type: "error",
          message: `Action "${actionName}" has target type "State String" but no state selected`,
          actionId,
        });
      }
      break;
  }
}
