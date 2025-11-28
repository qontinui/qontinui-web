/**
 * Canvas Validation System
 *
 * Validates workflows for:
 * - Connection validity (output types match, valid targets)
 * - Cycle detection (no infinite loops)
 * - Orphaned action detection (disconnected nodes)
 * - Missing connections (IF without true/false branches)
 * - Variable references (variables exist)
 * - Action configuration validity
 * - Real-time validation as user edits
 */

import type {
  Workflow,
  Action,
  Connections,
  Connection,
  ActionType,
} from "../lib/action-schema/action-types";
import { getActionOutputCount } from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface ValidationError {
  id: string;
  actionId?: string;
  type:
    | "connection"
    | "cycle"
    | "orphaned"
    | "missing_connection"
    | "invalid_config"
    | "variable"
    | "unreachable";
  severity: "error" | "warning" | "info";
  message: string;
  details?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  infos: ValidationError[];
}

export interface ValidationOptions {
  /** Check for cycles */
  checkCycles?: boolean;

  /** Check for orphaned actions */
  checkOrphaned?: boolean;

  /** Check for missing connections */
  checkMissingConnections?: boolean;

  /** Check for invalid connections */
  checkInvalidConnections?: boolean;

  /** Check variable references */
  checkVariables?: boolean;

  /** Check action configurations */
  checkConfigs?: boolean;

  /** Check for unreachable actions */
  checkUnreachable?: boolean;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate entire workflow
 */
export function validateWorkflow(
  workflow: Workflow,
  options: ValidationOptions = {}
): ValidationResult {
  const {
    checkCycles = true,
    checkOrphaned = true,
    checkMissingConnections = true,
    checkInvalidConnections = true,
    checkVariables = true,
    checkConfigs = true,
    checkUnreachable = true,
  } = options;

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const infos: ValidationError[] = [];

  // Check for empty workflow
  if (workflow.actions.length === 0) {
    infos.push({
      id: "empty-workflow",
      type: "invalid_config",
      severity: "info",
      message: "Workflow is empty",
    });
  }

  // Check for invalid connections
  if (checkInvalidConnections) {
    const connectionErrors = validateConnections(workflow);
    errors.push(...connectionErrors.filter((e) => e.severity === "error"));
    warnings.push(...connectionErrors.filter((e) => e.severity === "warning"));
  }

  // Check for cycles
  if (checkCycles) {
    const cycleErrors = detectCycles(workflow);
    errors.push(...cycleErrors);
  }

  // Check for orphaned actions
  if (checkOrphaned) {
    const orphanedWarnings = detectOrphanedActions(workflow);
    warnings.push(...orphanedWarnings);
  }

  // Check for missing connections
  if (checkMissingConnections) {
    const missingErrors = detectMissingConnections(workflow);
    errors.push(...missingErrors.filter((e) => e.severity === "error"));
    warnings.push(...missingErrors.filter((e) => e.severity === "warning"));
  }

  // Check for unreachable actions
  if (checkUnreachable) {
    const unreachableWarnings = detectUnreachableActions(workflow);
    warnings.push(...unreachableWarnings);
  }

  // Check variable references
  if (checkVariables) {
    const variableErrors = validateVariableReferences(workflow);
    warnings.push(...variableErrors);
  }

  // Check action configurations
  if (checkConfigs) {
    const configErrors = validateActionConfigs(workflow);
    errors.push(...configErrors.filter((e) => e.severity === "error"));
    warnings.push(...configErrors.filter((e) => e.severity === "warning"));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
  };
}

/**
 * Validate connections are valid
 */
function validateConnections(workflow: Workflow): ValidationError[] {
  const errors: ValidationError[] = [];
  const actionMap = new Map(workflow.actions.map((a) => [a.id, a]));

  for (const [sourceId, sourceConnections] of Object.entries(
    workflow.connections
  )) {
    const sourceAction = actionMap.get(sourceId);

    if (!sourceAction) {
      errors.push({
        id: `invalid-source-${sourceId}`,
        actionId: sourceId,
        type: "connection",
        severity: "error",
        message: `Source action ${sourceId} does not exist`,
      });
      continue;
    }

    for (const [outputType, outputs] of Object.entries(sourceConnections)) {
      if (!outputs) continue;

      for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
        const connections = outputs[outputIndex];

        for (const conn of connections) {
          const targetAction = actionMap.get(conn.action);

          if (!targetAction) {
            errors.push({
              id: `invalid-target-${sourceId}-${conn.action}`,
              actionId: sourceId,
              type: "connection",
              severity: "error",
              message: `Target action ${conn.action} does not exist`,
              details: {
                sourceId,
                targetId: conn.action,
                outputType,
                outputIndex,
              },
            });
            continue;
          }

          // Check for self-connections
          if (sourceId === conn.action) {
            errors.push({
              id: `self-connection-${sourceId}`,
              actionId: sourceId,
              type: "connection",
              severity: "warning",
              message: `Action ${sourceAction.name || sourceId} connects to itself`,
              details: { actionId: sourceId },
            });
          }

          // Validate output index
          const expectedOutputs = getActionOutputCount(
            sourceAction.type,
            sourceAction.config
          );
          if (outputIndex >= expectedOutputs) {
            errors.push({
              id: `invalid-output-${sourceId}-${outputIndex}`,
              actionId: sourceId,
              type: "connection",
              severity: "error",
              message: `Invalid output index ${outputIndex} for action ${sourceAction.name || sourceId}`,
              details: { sourceId, outputIndex, expectedOutputs },
            });
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Detect cycles in workflow graph
 */
function detectCycles(workflow: Workflow): ValidationError[] {
  const errors: ValidationError[] = [];
  const actionMap = new Map(workflow.actions.map((a) => [a.id, a]));

  // Build adjacency list
  const graph = new Map<string, string[]>();
  for (const action of workflow.actions) {
    graph.set(action.id, []);
  }

  for (const [sourceId, sourceConnections] of Object.entries(
    workflow.connections
  )) {
    const neighbors: string[] = [];

    for (const outputs of Object.values(sourceConnections)) {
      if (!outputs) continue;

      for (const connections of outputs) {
        for (const conn of connections) {
          if (!neighbors.includes(conn.action)) {
            neighbors.push(conn.action);
          }
        }
      }
    }

    graph.set(sourceId, neighbors);
  }

  // DFS to detect cycles
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(nodeId: string): string[] | null {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    pathStack.push(nodeId);

    const neighbors = graph.get(nodeId) || [];

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        const cycle = dfs(neighbor);
        if (cycle) return cycle;
      } else if (recursionStack.has(neighbor)) {
        // Found cycle
        const cycleStart = pathStack.indexOf(neighbor);
        return pathStack.slice(cycleStart);
      }
    }

    recursionStack.delete(nodeId);
    pathStack.pop();
    return null;
  }

  for (const action of workflow.actions) {
    if (!visited.has(action.id)) {
      const cycle = dfs(action.id);

      if (cycle) {
        const cycleNames = cycle
          .map((id) => actionMap.get(id)?.name || id)
          .join(" → ");

        errors.push({
          id: `cycle-${cycle.join("-")}`,
          type: "cycle",
          severity: "error",
          message: `Circular dependency detected: ${cycleNames}`,
          details: { cycle },
        });
      }
    }
  }

  return errors;
}

/**
 * Detect orphaned actions (not connected to anything)
 */
function detectOrphanedActions(workflow: Workflow): ValidationError[] {
  const warnings: ValidationError[] = [];

  const connected = new Set<string>();

  // Mark all connected actions
  for (const [sourceId, sourceConnections] of Object.entries(
    workflow.connections
  )) {
    connected.add(sourceId);

    for (const outputs of Object.values(sourceConnections)) {
      if (!outputs) continue;

      for (const connections of outputs) {
        for (const conn of connections) {
          connected.add(conn.action);
        }
      }
    }
  }

  // Check for orphaned actions
  for (const action of workflow.actions) {
    if (!connected.has(action.id)) {
      warnings.push({
        id: `orphaned-${action.id}`,
        actionId: action.id,
        type: "orphaned",
        severity: "warning",
        message: `Action "${action.name || action.type}" is not connected`,
        details: { actionId: action.id },
      });
    }
  }

  return warnings;
}

/**
 * Detect missing required connections
 */
function detectMissingConnections(workflow: Workflow): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const action of workflow.actions) {
    const connections = workflow.connections[action.id];
    const expectedOutputs = getActionOutputCount(action.type, action.config);

    // Check for actions that should have connections
    if (action.type === "IF") {
      // IF must have both true and false branches
      const mainOutputs = connections?.main || [];

      if (
        mainOutputs.length < 2 ||
        !mainOutputs[0]?.length ||
        !mainOutputs[1]?.length
      ) {
        errors.push({
          id: `missing-if-branch-${action.id}`,
          actionId: action.id,
          type: "missing_connection",
          severity: "error",
          message: `IF action "${action.name || action.id}" must have both true and false branches`,
          details: {
            actionId: action.id,
            hasTrue: !!mainOutputs[0]?.length,
            hasFalse: !!mainOutputs[1]?.length,
          },
        });
      }
    }

    if (action.type === "SWITCH") {
      // SWITCH must have all case branches
      const cases = (action.config as any).cases || [];
      const mainOutputs = connections?.main || [];

      if (mainOutputs.length < cases.length + 1) {
        errors.push({
          id: `missing-switch-branch-${action.id}`,
          actionId: action.id,
          type: "missing_connection",
          severity: "warning",
          message: `SWITCH action "${action.name || action.id}" is missing some case branches`,
          details: {
            actionId: action.id,
            expectedBranches: cases.length + 1,
            actualBranches: mainOutputs.length,
          },
        });
      }
    }

    if (action.type === "TRY_CATCH") {
      // TRY_CATCH should have both success and error branches
      const mainOutputs = connections?.main || [];

      if (mainOutputs.length < 2 || !mainOutputs[0]?.length) {
        errors.push({
          id: `missing-try-success-${action.id}`,
          actionId: action.id,
          type: "missing_connection",
          severity: "warning",
          message: `TRY_CATCH action "${action.name || action.id}" should have a success branch`,
          details: { actionId: action.id },
        });
      }

      if (!mainOutputs[1]?.length) {
        errors.push({
          id: `missing-catch-${action.id}`,
          actionId: action.id,
          type: "missing_connection",
          severity: "info",
          message: `TRY_CATCH action "${action.name || action.id}" has no catch handler`,
          details: { actionId: action.id },
        });
      }
    }
  }

  return errors;
}

/**
 * Detect unreachable actions (not reachable from any start node)
 */
function detectUnreachableActions(workflow: Workflow): ValidationError[] {
  const warnings: ValidationError[] = [];

  // Find all actions with no incoming connections (potential start nodes)
  const hasIncoming = new Set<string>();

  for (const sourceConnections of Object.values(workflow.connections)) {
    for (const outputs of Object.values(sourceConnections)) {
      if (!outputs) continue;

      for (const connections of outputs) {
        for (const conn of connections) {
          hasIncoming.add(conn.action);
        }
      }
    }
  }

  const startNodes = workflow.actions.filter((a) => !hasIncoming.has(a.id));

  if (startNodes.length === 0) {
    warnings.push({
      id: "no-start-node",
      type: "unreachable",
      severity: "warning",
      message: "No start node found (no action without incoming connections)",
    });
    return warnings;
  }

  // BFS from start nodes to find reachable actions
  const reachable = new Set<string>();
  const queue = [...startNodes.map((a) => a.id)];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;

    reachable.add(nodeId);

    const connections = workflow.connections[nodeId];
    if (!connections) continue;

    for (const outputs of Object.values(connections)) {
      if (!outputs) continue;

      for (const conns of outputs) {
        for (const conn of conns) {
          if (!reachable.has(conn.action)) {
            queue.push(conn.action);
          }
        }
      }
    }
  }

  // Check for unreachable actions
  for (const action of workflow.actions) {
    if (!reachable.has(action.id)) {
      warnings.push({
        id: `unreachable-${action.id}`,
        actionId: action.id,
        type: "unreachable",
        severity: "warning",
        message: `Action "${action.name || action.type}" is unreachable from start nodes`,
        details: { actionId: action.id },
      });
    }
  }

  return warnings;
}

/**
 * Validate variable references
 */
function validateVariableReferences(workflow: Workflow): ValidationError[] {
  const warnings: ValidationError[] = [];

  // TODO: Implement variable reference validation
  // This would require parsing action configs for variable references
  // and checking against workflow.variables

  return warnings;
}

/**
 * Validate action configurations
 */
function validateActionConfigs(workflow: Workflow): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const action of workflow.actions) {
    // TODO: Implement config validation based on action type
    // This would require schema validation for each action type

    // Basic validation: check if config exists
    if (!action.config) {
      errors.push({
        id: `missing-config-${action.id}`,
        actionId: action.id,
        type: "invalid_config",
        severity: "error",
        message: `Action "${action.name || action.type}" is missing configuration`,
        details: { actionId: action.id },
      });
    }
  }

  return errors;
}

// ============================================================================
// Validation Manager Class
// ============================================================================

export class ValidationManager {
  private lastValidation: ValidationResult | null = null;
  private validationCache = new Map<string, ValidationResult>();

  /**
   * Validate workflow with caching
   */
  validate(workflow: Workflow, options?: ValidationOptions): ValidationResult {
    const cacheKey = this.getCacheKey(workflow);
    const cached = this.validationCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const result = validateWorkflow(workflow, options);
    this.lastValidation = result;
    this.validationCache.set(cacheKey, result);

    // Limit cache size
    if (this.validationCache.size > 100) {
      const firstKey = this.validationCache.keys().next().value;
      this.validationCache.delete(firstKey);
    }

    return result;
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.validationCache.clear();
  }

  /**
   * Get last validation result
   */
  getLastValidation(): ValidationResult | null {
    return this.lastValidation;
  }

  /**
   * Generate cache key for workflow
   */
  private getCacheKey(workflow: Workflow): string {
    // Simple cache key based on action count and connection count
    const actionCount = workflow.actions.length;
    const connectionCount = Object.keys(workflow.connections).length;
    const hash = JSON.stringify(workflow)
      .split("")
      .reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0);

    return `${actionCount}-${connectionCount}-${hash}`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new validation manager instance
 */
export function createValidationManager(): ValidationManager {
  return new ValidationManager();
}
