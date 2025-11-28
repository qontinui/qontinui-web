/**
 * Workflow validation - Graph format only
 *
 * Clean, focused validation for graph-based workflows.
 * Errors only - no warnings. Make it pass or fail.
 */

import {
  Workflow,
  Connection,
  getActionOutputCount,
  getActionInputCount,
} from "./action-types";
import {
  getEntryPoints,
  hasCycles,
  findOrphanedActions,
  getActionById,
  getActionConnections,
} from "./workflow-utils";

// ============================================================================
// Validation Types
// ============================================================================

export type ValidationErrorType =
  | "missing_action"
  | "invalid_connection"
  | "cycle_detected"
  | "missing_entry_point"
  | "invalid_output_index"
  | "invalid_input_index"
  | "duplicate_action_id"
  | "invalid_connection_type"
  | "missing_connections"
  | "invalid_position"
  | "orphaned_action";

/**
 * Validation error
 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  actionId?: string;
  details?: any;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ============================================================================
// Main Validation
// ============================================================================

/**
 * Validate a complete workflow
 *
 * Runs all validation checks and returns errors.
 * No warnings - either it's valid or it's not.
 */
export function validateWorkflow(workflow: Workflow): ValidationResult {
  const errors: ValidationError[] = [];

  // Basic structure validation
  if (!workflow.id) {
    errors.push({
      type: "missing_action",
      message: "Workflow must have an id",
    });
  }

  if (!workflow.name) {
    errors.push({
      type: "missing_action",
      message: "Workflow must have a name",
    });
  }

  if (!workflow.version) {
    errors.push({
      type: "missing_action",
      message: "Workflow must have a version",
    });
  }

  if (!workflow.actions || !Array.isArray(workflow.actions)) {
    errors.push({
      type: "missing_action",
      message: "Workflow must have an actions array",
    });
    return { valid: false, errors };
  }

  if (workflow.actions.length === 0) {
    errors.push({
      type: "missing_action",
      message: "Workflow must have at least one action",
    });
    return { valid: false, errors };
  }

  // Format must be 'graph'
  if (workflow.format !== "graph") {
    errors.push({
      type: "invalid_connection",
      message: `Workflow format must be 'graph', got '${workflow.format}'`,
    });
  }

  // Must have connections
  if (!workflow.connections) {
    errors.push({
      type: "missing_connections",
      message: "Graph format workflows must have connections",
    });
    return { valid: false, errors };
  }

  // Validate action IDs are unique
  const actionIds = new Set<string>();
  workflow.actions.forEach((action) => {
    if (actionIds.has(action.id)) {
      errors.push({
        type: "duplicate_action_id",
        message: `Duplicate action ID: ${action.id}`,
        actionId: action.id,
      });
    }
    actionIds.add(action.id);
  });

  // Validate connections
  validateConnections(workflow, errors);

  // Validate positions
  validatePositions(workflow, errors);

  // Check for cycles
  if (hasCycles(workflow)) {
    errors.push({
      type: "cycle_detected",
      message: "Workflow contains circular dependencies (cycles)",
    });
  }

  // Check for entry points
  const entryPoints = getEntryPoints(workflow);
  if (entryPoints.length === 0) {
    errors.push({
      type: "missing_entry_point",
      message: "Workflow has no entry points",
    });
  }

  // Check for orphans (this is an error in our clean design)
  const orphans = findOrphanedActions(workflow);
  if (orphans.length > 0) {
    errors.push({
      type: "orphaned_action",
      message: `Found ${orphans.length} orphaned action(s): ${orphans.join(", ")}`,
      details: { orphans },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Connection Validation
// ============================================================================

/**
 * Validate all connections reference valid actions and have correct indices
 */
function validateConnections(
  workflow: Workflow,
  errors: ValidationError[]
): void {
  if (!workflow.connections) {
    return;
  }

  const actionIds = new Set(workflow.actions.map((a) => a.id));

  Object.entries(workflow.connections).forEach(([sourceId, outputs]) => {
    // Validate source action exists
    if (!actionIds.has(sourceId)) {
      errors.push({
        type: "missing_action",
        message: `Connection source action not found: ${sourceId}`,
        actionId: sourceId,
      });
      return;
    }

    const sourceAction = getActionById(workflow, sourceId)!;
    const outputCount = getActionOutputCount(
      sourceAction.type,
      sourceAction.config
    );

    // Validate each connection type
    ["main", "error", "success", "parallel"].forEach((type) => {
      const connections = outputs[type as keyof typeof outputs];
      if (!connections) return;

      // Validate output index
      if (connections.length > outputCount) {
        errors.push({
          type: "invalid_output_index",
          message: `Action ${sourceId} (${sourceAction.type}) has ${outputCount} outputs but connections use ${connections.length} outputs`,
          actionId: sourceId,
          details: {
            expectedOutputs: outputCount,
            actualOutputs: connections.length,
          },
        });
      }

      // Validate each output's connections
      connections.forEach((outputConnections, outputIndex) => {
        outputConnections.forEach((conn, connIndex) => {
          // Validate target action exists
          if (!actionIds.has(conn.action)) {
            errors.push({
              type: "missing_action",
              message: `Connection target action not found: ${conn.action}`,
              actionId: sourceId,
              details: {
                targetAction: conn.action,
                outputIndex,
                connectionIndex: connIndex,
              },
            });
            return;
          }

          // Validate connection type
          const validTypes = ["main", "error", "success", "parallel"];
          if (!validTypes.includes(conn.type)) {
            errors.push({
              type: "invalid_connection_type",
              message: `Invalid connection type: ${conn.type}`,
              actionId: sourceId,
              details: {
                connection: conn,
                outputIndex,
                connectionIndex: connIndex,
              },
            });
          }

          // Validate target input index
          const targetAction = getActionById(workflow, conn.action)!;
          const inputCount = getActionInputCount(targetAction.type);
          if (conn.index >= inputCount) {
            errors.push({
              type: "invalid_input_index",
              message: `Target action ${conn.action} (${targetAction.type}) has ${inputCount} inputs but connection uses index ${conn.index}`,
              actionId: sourceId,
              details: {
                targetAction: conn.action,
                expectedInputs: inputCount,
                actualIndex: conn.index,
              },
            });
          }
        });
      });
    });
  });
}

// ============================================================================
// Position Validation
// ============================================================================

/**
 * Validate action positions are present and valid
 */
function validatePositions(
  workflow: Workflow,
  errors: ValidationError[]
): void {
  workflow.actions.forEach((action) => {
    if (!action.position) {
      errors.push({
        type: "invalid_position",
        message: `Action ${action.id} is missing position (required for graph format)`,
        actionId: action.id,
      });
      return;
    }

    // Validate position format
    if (!Array.isArray(action.position) || action.position.length !== 2) {
      errors.push({
        type: "invalid_position",
        message: `Action ${action.id} has invalid position format (expected [x, y])`,
        actionId: action.id,
        details: { position: action.position },
      });
      return;
    }

    const [x, y] = action.position;

    // Validate position values are numbers
    if (typeof x !== "number" || typeof y !== "number") {
      errors.push({
        type: "invalid_position",
        message: `Action ${action.id} has non-numeric position values`,
        actionId: action.id,
        details: { position: action.position },
      });
      return;
    }

    // Validate positions are finite
    if (!isFinite(x) || !isFinite(y)) {
      errors.push({
        type: "invalid_position",
        message: `Action ${action.id} has invalid position values (NaN or Infinity)`,
        actionId: action.id,
        details: { position: action.position },
      });
    }
  });
}

// ============================================================================
// Quick Validation Check
// ============================================================================

/**
 * Quick validation check - returns true if workflow is valid
 */
export function isWorkflowValid(workflow: Workflow): boolean {
  const result = validateWorkflow(workflow);
  return result.valid;
}

/**
 * Get validation summary as a formatted string
 */
export function getValidationSummary(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push("Workflow is valid");
  } else {
    lines.push("Workflow validation failed");
  }

  if (result.errors.length > 0) {
    lines.push(`\nErrors (${result.errors.length}):`);
    result.errors.forEach((error, i) => {
      lines.push(`  ${i + 1}. [${error.type}] ${error.message}`);
      if (error.actionId) {
        lines.push(`     Action: ${error.actionId}`);
      }
      if (error.details) {
        lines.push(`     Details: ${JSON.stringify(error.details)}`);
      }
    });
  }

  return lines.join("\n");
}
