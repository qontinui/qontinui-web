/**
 * Workflow utility functions - Graph format only
 *
 * Clean utilities for working with graph-based workflows.
 * No backward compatibility cruft, no format detection.
 */

import {
  Workflow,
  Connections,
  Connection,
  Action,
  ActionType,
  getActionOutputCount,
} from './action-types';

// ============================================================================
// Entry and Exit Points
// ============================================================================

/**
 * Get all actions that are entry points (no incoming connections)
 */
export function getEntryPoints(workflow: Workflow): string[] {
  const actionsWithIncoming = new Set<string>();

  Object.values(workflow.connections).forEach((outputs) => {
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const connections = outputs[type as keyof typeof outputs];
      if (connections) {
        connections.forEach((outputConnections) => {
          outputConnections.forEach((conn) => {
            actionsWithIncoming.add(conn.action);
          });
        });
      }
    });
  });

  return workflow.actions
    .map((action) => action.id)
    .filter((id) => !actionsWithIncoming.has(id));
}

/**
 * Get all connections originating from a specific action
 */
export function getActionConnections(
  workflow: Workflow,
  actionId: string
): Connections[string] | undefined {
  return workflow.connections[actionId];
}

// ============================================================================
// Action Traversal
// ============================================================================

/**
 * Get all actions that follow a specific action
 */
export function getNextActions(
  workflow: Workflow,
  actionId: string,
  connectionType?: 'main' | 'error' | 'success' | 'parallel'
): string[] {
  const connections = getActionConnections(workflow, actionId);
  if (!connections) {
    return [];
  }

  const nextActionIds = new Set<string>();
  const types = connectionType
    ? [connectionType]
    : (['main', 'error', 'success', 'parallel'] as const);

  types.forEach((type) => {
    const typeConnections = connections[type];
    if (typeConnections) {
      typeConnections.forEach((outputConnections) => {
        outputConnections.forEach((conn) => {
          nextActionIds.add(conn.action);
        });
      });
    }
  });

  return Array.from(nextActionIds);
}

/**
 * Get all actions that precede a specific action
 */
export function getPreviousActions(
  workflow: Workflow,
  actionId: string
): string[] {
  const previousActionIds: string[] = [];

  Object.entries(workflow.connections).forEach(([sourceId, outputs]) => {
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const connections = outputs[type as keyof typeof outputs];
      if (connections) {
        connections.forEach((outputConnections) => {
          if (outputConnections.some((conn) => conn.action === actionId)) {
            previousActionIds.push(sourceId);
          }
        });
      }
    });
  });

  return previousActionIds;
}

// ============================================================================
// Graph Analysis
// ============================================================================

/**
 * Check if workflow contains cycles (circular dependencies)
 */
export function hasCycles(workflow: Workflow): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycleFrom = (actionId: string): boolean => {
    if (recursionStack.has(actionId)) {
      return true; // Cycle detected
    }

    if (visited.has(actionId)) {
      return false; // Already checked this path
    }

    visited.add(actionId);
    recursionStack.add(actionId);

    const nextActions = getNextActions(workflow, actionId);
    for (const nextId of nextActions) {
      if (hasCycleFrom(nextId)) {
        return true;
      }
    }

    recursionStack.delete(actionId);
    return false;
  };

  const entryPoints = getEntryPoints(workflow);
  for (const entryPoint of entryPoints) {
    if (hasCycleFrom(entryPoint)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if workflow has merge nodes (actions with multiple inputs)
 */
export function hasMergeNodes(workflow: Workflow): boolean {
  const incomingCounts = new Map<string, number>();

  Object.values(workflow.connections).forEach((outputs) => {
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const connections = outputs[type as keyof typeof outputs];
      if (connections) {
        connections.forEach((outputConnections) => {
          outputConnections.forEach((conn) => {
            const count = incomingCounts.get(conn.action) || 0;
            incomingCounts.set(conn.action, count + 1);
          });
        });
      }
    });
  });

  return Array.from(incomingCounts.values()).some((count) => count > 1);
}

/**
 * Find all orphaned actions (not connected to the main graph)
 */
export function findOrphanedActions(workflow: Workflow): string[] {
  if (Object.keys(workflow.connections).length === 0) {
    return workflow.actions.map((a) => a.id);
  }

  const connected = new Set<string>();

  // Add all actions with outgoing connections
  Object.keys(workflow.connections).forEach((id) => connected.add(id));

  // Add all actions with incoming connections
  Object.values(workflow.connections).forEach((outputs) => {
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const connections = outputs[type as keyof typeof outputs];
      if (connections) {
        connections.forEach((outputConnections) => {
          outputConnections.forEach((conn) => {
            connected.add(conn.action);
          });
        });
      }
    });
  });

  return workflow.actions.map((a) => a.id).filter((id) => !connected.has(id));
}

// ============================================================================
// Action Lookup
// ============================================================================

/**
 * Get action by ID
 */
export function getActionById(
  workflow: Workflow,
  actionId: string
): Action | undefined {
  return workflow.actions.find((a) => a.id === actionId);
}

/**
 * Get all actions of a specific type
 */
export function getActionsByType(
  workflow: Workflow,
  actionType: ActionType
): Action[] {
  return workflow.actions.filter((a) => a.type === actionType);
}

// ============================================================================
// Depth and Ordering
// ============================================================================

/**
 * Calculate the depth of each action in the workflow graph
 *
 * Depth is the minimum distance from an entry point to the action.
 */
export function calculateActionDepths(workflow: Workflow): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: Array<{ actionId: string; depth: number }> = [];
  const entryPoints = getEntryPoints(workflow);

  entryPoints.forEach((id) => {
    queue.push({ actionId: id, depth: 0 });
    depths.set(id, 0);
  });

  while (queue.length > 0) {
    const { actionId, depth } = queue.shift()!;
    const nextActions = getNextActions(workflow, actionId);

    nextActions.forEach((nextId) => {
      const currentDepth = depths.get(nextId);
      const newDepth = depth + 1;

      if (currentDepth === undefined || newDepth < currentDepth) {
        depths.set(nextId, newDepth);
        queue.push({ actionId: nextId, depth: newDepth });
      }
    });
  }

  return depths;
}

/**
 * Get topological order of actions (valid execution order)
 *
 * Returns actions in an order where all dependencies come before dependents.
 * Returns null if cycles exist.
 */
export function getTopologicalOrder(workflow: Workflow): string[] | null {
  if (hasCycles(workflow)) {
    return null; // Cannot sort cyclic graph
  }

  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (actionId: string) => {
    if (visited.has(actionId)) {
      return;
    }

    visited.add(actionId);
    const nextActions = getNextActions(workflow, actionId);
    nextActions.forEach(visit);
    order.unshift(actionId); // Add to front for reverse post-order
  };

  getEntryPoints(workflow).forEach(visit);

  return order;
}

// ============================================================================
// Workflow Cloning
// ============================================================================

/**
 * Clone a workflow with new IDs
 */
export function cloneWorkflow(
  workflow: Workflow,
  newWorkflowId?: string
): Workflow {
  const idMap = new Map<string, string>();

  // Generate new IDs for all actions
  const newActions = workflow.actions.map((action) => {
    const newId = `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    idMap.set(action.id, newId);
    return {
      ...action,
      id: newId,
    };
  });

  // Update connection IDs
  const newConnections: Connections = {};
  Object.entries(workflow.connections).forEach(([oldSourceId, outputs]) => {
    const newSourceId = idMap.get(oldSourceId);
    if (!newSourceId) return;

    newConnections[newSourceId] = {};
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const connections = outputs[type as keyof typeof outputs];
      if (connections) {
        newConnections[newSourceId][type as keyof typeof outputs] =
          connections.map((outputConnections) =>
            outputConnections.map((conn) => ({
              ...conn,
              action: idMap.get(conn.action) || conn.action,
            }))
          );
      }
    });
  });

  return {
    ...workflow,
    id: newWorkflowId || `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    actions: newActions,
    connections: newConnections,
  };
}

// ============================================================================
// Process to Workflow Conversion (Legacy Support)
// ============================================================================

/**
 * Legacy Process type (for backward compatibility)
 */
export interface LegacyProcess {
  id: string;
  name: string;
  description: string;
  category?: string;
  actions: Array<{
    id: string;
    type: string;
    config: Record<string, any>;
  }>;
  initialScreenshotId?: string;
  initialStateIds?: string[];
}

/**
 * Convert legacy Process to unified Workflow format
 *
 * This adds:
 * - positions to actions (auto-generated vertically)
 * - connections between actions (linear chain)
 * - viewMode metadata hint
 */
export function processToWorkflow(process: LegacyProcess): Workflow {
  const actions: Action[] = [];
  const connections: Connections = {};

  // Convert actions and add positions
  process.actions.forEach((oldAction, index) => {
    const action: Action = {
      ...oldAction,
      position: [100, 100 + index * 150], // Vertical layout with 150px spacing
    } as Action;

    actions.push(action);

    // Create linear connection to next action
    if (index < process.actions.length - 1) {
      const nextActionId = process.actions[index + 1].id;
      connections[action.id] = {
        main: [[{ action: nextActionId, type: 'main', index: 0 }]],
      };
    }
  });

  return {
    id: process.id,
    name: process.name,
    version: '1.0.0',
    format: 'graph',
    category: process.category,
    description: process.description || '',
    actions,
    connections,
    initialScreenshotId: process.initialScreenshotId,
    initialStateIds: process.initialStateIds,
    metadata: {
      viewMode: 'sequential', // Mark as sequential since it came from Process
      created: new Date().toISOString(),
    },
  };
}

/**
 * Convert Workflow back to Process format (for backward compatibility)
 *
 * WARNING: This loses graph structure! Only works for linear workflows.
 * Returns null if workflow has branching.
 */
export function workflowToProcess(workflow: Workflow): LegacyProcess | null {
  if (!isLinearWorkflow(workflow)) {
    return null; // Cannot convert non-linear workflow to process
  }

  // Get actions in execution order
  const orderedActions = getLinearActionOrder(workflow);

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || '',
    category: workflow.category,
    actions: orderedActions.map((action) => ({
      id: action.id,
      type: action.type,
      config: action.config,
    })),
    initialScreenshotId: workflow.initialScreenshotId,
    initialStateIds: workflow.initialStateIds,
  };
}

// ============================================================================
// Linear Workflow Detection & Analysis
// ============================================================================

/**
 * Check if a workflow is linear (no branching)
 *
 * A linear workflow:
 * - Has no IF, SWITCH, TRY_CATCH actions with branching
 * - Each action has at most one outgoing connection
 * - No parallel or error paths
 */
export function isLinearWorkflow(workflow: Workflow): boolean {
  // Check connections for branching
  for (const sourceId in workflow.connections) {
    const outputs = workflow.connections[sourceId];

    // Check for error/success connections
    if (outputs.error && outputs.error.length > 0) return false;
    if (outputs.success && outputs.success.length > 0) return false;

    // Check for multiple main outputs (branching)
    if (outputs.main) {
      // Multiple output indices = branching (e.g., IF with true/false)
      if (outputs.main.length > 1) return false;

      // Multiple connections from same output = parallel paths
      if (outputs.main[0] && outputs.main[0].length > 1) return false;
    }
  }

  return true;
}

/**
 * Get actions in linear execution order
 *
 * Only works for linear workflows. Returns empty array for branching workflows.
 */
export function getLinearActionOrder(workflow: Workflow): Action[] {
  if (!isLinearWorkflow(workflow)) {
    return [];
  }

  const { actions, connections } = workflow;

  if (actions.length === 0) return [];
  if (actions.length === 1) return actions;

  // Build incoming connections map
  const incomingMap = new Map<string, string[]>();
  for (const sourceId in connections) {
    const outputs = connections[sourceId].main;
    if (outputs && outputs[0]) {
      outputs[0].forEach((conn) => {
        if (!incomingMap.has(conn.action)) {
          incomingMap.set(conn.action, []);
        }
        incomingMap.get(conn.action)!.push(sourceId);
      });
    }
  }

  // Find entry point (action with no incoming connections)
  const entryActions = actions.filter((a) => !incomingMap.has(a.id));

  if (entryActions.length === 0) {
    console.warn('[getLinearActionOrder] No entry point found, using first action');
    return actions; // Fallback to original order
  }

  // Follow the chain from entry point
  const ordered: Action[] = [];
  let current = entryActions[0];

  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);

    // Find next action
    const nextConnections = connections[current.id]?.main?.[0];
    if (!nextConnections || nextConnections.length === 0) {
      break; // End of chain
    }

    const nextActionId = nextConnections[0].action;
    current = actions.find((a) => a.id === nextActionId) || null;
  }

  return ordered;
}

/**
 * Detect the suggested view mode for a workflow
 *
 * Returns 'sequential' if workflow is linear, 'graph' if it has branching
 */
export function detectViewMode(workflow: Workflow): 'sequential' | 'graph' {
  // Check metadata hint first
  if (workflow.metadata?.viewMode) {
    return workflow.metadata.viewMode;
  }

  // Auto-detect based on structure
  return isLinearWorkflow(workflow) ? 'sequential' : 'graph';
}

// ============================================================================
// Workflow Creation Helpers
// ============================================================================

/**
 * Create a new empty workflow
 */
export function createWorkflow(options: {
  name: string;
  category?: string;
  description?: string;
  viewMode?: 'sequential' | 'graph';
}): Workflow {
  return {
    id: `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: options.name,
    version: '1.0.0',
    format: 'graph',
    category: options.category || 'Main',
    description: options.description || '',
    actions: [],
    connections: {},
    metadata: {
      viewMode: options.viewMode || 'sequential',
      created: new Date().toISOString(),
    },
  };
}

// ============================================================================
// Action Position Management
// ============================================================================

/**
 * Auto-layout actions vertically (for sequential workflows)
 */
export function autoLayoutVertical(workflow: Workflow): Workflow {
  const orderedActions = isLinearWorkflow(workflow)
    ? getLinearActionOrder(workflow)
    : workflow.actions;

  const updatedActions = orderedActions.map((action, index) => ({
    ...action,
    position: [100, 100 + index * 150] as [number, number],
  }));

  return {
    ...workflow,
    actions: updatedActions,
  };
}

/**
 * Ensure all actions have valid positions
 * Adds default positions to any actions missing them
 */
export function ensurePositions(workflow: Workflow): Workflow {
  let hasChanges = false;
  const updatedActions = workflow.actions.map((action, index) => {
    if (!action.position || action.position.length !== 2) {
      hasChanges = true;
      return {
        ...action,
        position: [100 + (index % 5) * 250, 100 + Math.floor(index / 5) * 150] as [number, number],
      };
    }
    return action;
  });

  return hasChanges ? { ...workflow, actions: updatedActions } : workflow;
}

// ============================================================================
// Connection Management for Sequential Workflows
// ============================================================================

/**
 * Build linear connections for sequential actions
 *
 * Creates simple main connections: action[0] → action[1] → action[2] → ...
 */
export function buildLinearConnections(actions: Action[]): Connections {
  const connections: Connections = {};

  for (let i = 0; i < actions.length - 1; i++) {
    const currentId = actions[i].id;
    const nextId = actions[i + 1].id;

    connections[currentId] = {
      main: [[{ action: nextId, type: 'main', index: 0 }]],
    };
  }

  return connections;
}
