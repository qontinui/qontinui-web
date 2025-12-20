/**
 * Format converter - Convert between sequential workflow format and graph Workflow formats
 */

import type {
  Workflow,
  Action as WorkflowAction,
  Connections,
} from "./action-schema/action-types";

// Legacy Process type for backward compatibility
interface Process {
  id: string;
  name: string;
  description?: string;
  category?: string;
  actions: unknown[];
}

/**
 * Convert a sequential Process to a graph Workflow
 */
export function processToWorkflow(process: Process): Workflow {
  // Convert actions to graph format (add positions)
  const actions: WorkflowAction[] = process.actions.map(
    (action: unknown, index: number) =>
      ({
        ...(action as Partial<WorkflowAction>),
        position: [100 + index * 250, 100] as [number, number], // Horizontal layout
      }) as WorkflowAction
  );

  // Create linear connections (sequential flow)
  const connections: Connections = {};

  for (let i = 0; i < actions.length - 1; i++) {
    const source = actions[i];
    const target = actions[i + 1];

    if (source && target) {
      connections[source.id] = {
        main: [[{ action: target.id, type: "main", index: 0 }]],
      };
    }
  }

  return {
    id: `workflow-${process.id}`,
    name: `${process.name} (converted)`,
    version: "1.0.0",
    format: "graph",
    actions,
    connections,
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      version: "1.0.0",
      convertedFrom: "sequential",
      originalProcessId: process.id,
    },
  };
}

/**
 * Convert a graph Workflow to a sequential Process
 *
 * Note: This performs a topological sort to linearize the graph.
 * Complex control flow (branches, loops, parallel execution) will be flattened.
 */
export function workflowToProcess(workflow: Workflow): Process {
  // Perform topological sort to get linear order
  const sortedActions = topologicalSort(workflow.actions, workflow.connections);

  return {
    id: `process-${workflow.id}`,
    name: `${workflow.name} (converted)`,
    description: "Converted from graph workflow",
    category: "Main",
    actions: sortedActions,
  };
}

/**
 * Topological sort to linearize a graph workflow
 */
function topologicalSort(
  actions: WorkflowAction[],
  connections: Connections
): unknown[] {
  const actionMap = new Map(actions.map((a) => [a.id, a]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize in-degree and adjacency list
  actions.forEach((action) => {
    inDegree.set(action.id, 0);
    adjList.set(action.id, []);
  });

  // Build graph
  Object.entries(connections).forEach(([sourceId, outputs]) => {
    // Check all connection types
    ["main", "error", "success", "parallel"].forEach((connType) => {
      const connArray = outputs[connType as keyof typeof outputs];
      if (connArray) {
        connArray.forEach((outputConns) => {
          outputConns.forEach((conn) => {
            adjList.get(sourceId)?.push(conn.action);
            inDegree.set(conn.action, (inDegree.get(conn.action) || 0) + 1);
          });
        });
      }
    });
  });

  // Find entry points (nodes with in-degree 0)
  const queue: string[] = [];
  inDegree.forEach((degree, actionId) => {
    if (degree === 0) {
      queue.push(actionId);
    }
  });

  // Perform topological sort
  const sorted: unknown[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const action = actionMap.get(current);

    if (action) {
      // Remove position property
      const { position, ...actionWithoutPosition } = action;
      sorted.push(actionWithoutPosition);
    }

    // Process neighbors
    const neighbors = adjList.get(current) || [];
    neighbors.forEach((neighbor) => {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    });
  }

  // Handle orphaned nodes (not connected)
  actions.forEach((action) => {
    const sortedAction = sorted.find(
      (a) => (a as WorkflowAction).id === action.id
    );
    if (!sortedAction) {
      const { position, ...actionWithoutPosition } = action;
      sorted.push(actionWithoutPosition);
    }
  });

  return sorted;
}

/**
 * Validate if a process can be converted to workflow
 */
export function canConvertToWorkflow(process: Process): {
  canConvert: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (process.actions.length === 0) {
    warnings.push("Process has no actions");
  }

  if (process.actions.length > 50) {
    warnings.push(
      "Large processes (>50 actions) may be hard to visualize in graph format"
    );
  }

  return {
    canConvert: true,
    warnings,
  };
}

/**
 * Validate if a workflow can be converted to process
 */
export function canConvertToProcess(workflow: Workflow): {
  canConvert: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (workflow.actions.length === 0) {
    warnings.push("Workflow has no actions");
  }

  // Check for complex control flow
  Object.values(workflow.connections).some((outputs) => {
    // Check for multiple outputs (branching)
    const mainOutputs = outputs.main?.[0]?.length || 0;
    if (mainOutputs > 1) {
      warnings.push(
        "Workflow contains branching - only the first path will be kept"
      );
      return true;
    }

    // Check for error/success handlers
    if (outputs.error && outputs.error.length > 0) {
      warnings.push("Error handling connections will be lost");
      return true;
    }

    return false;
  });

  // Check for cycles (loops)
  const hasCycles = detectCycles(workflow.actions, workflow.connections);
  if (hasCycles) {
    warnings.push(
      "Workflow contains loops - they will be unrolled in sequential format"
    );
  }

  return {
    canConvert: true,
    warnings,
  };
}

/**
 * Detect cycles in the workflow graph
 */
function detectCycles(
  actions: WorkflowAction[],
  connections: Connections
): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (nodeId: string): boolean => {
    if (recursionStack.has(nodeId)) {
      return true; // Cycle detected
    }

    if (visited.has(nodeId)) {
      return false; // Already visited
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Check all outgoing connections
    const outputs = connections[nodeId];
    if (outputs) {
      const allTargets: string[] = [];

      // Collect all target nodes
      ["main", "error", "success", "parallel"].forEach((connType) => {
        const connArray = outputs[connType as keyof typeof outputs];
        if (connArray) {
          connArray.forEach((outputConns) => {
            outputConns.forEach((conn) => {
              allTargets.push(conn.action);
            });
          });
        }
      });

      // Check each target
      for (const target of allTargets) {
        if (hasCycle(target)) {
          return true;
        }
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  // Check from each entry point
  for (const action of actions) {
    if (hasCycle(action.id)) {
      return true;
    }
  }

  return false;
}
