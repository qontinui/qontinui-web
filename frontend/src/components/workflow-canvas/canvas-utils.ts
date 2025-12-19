/**
 * Canvas utility functions for workflow conversion and manipulation
 *
 * Handles conversion between qontinui Workflow format and React Flow format,
 * plus validation and helper functions.
 */

import { MarkerType } from "@xyflow/react";
import {
  Workflow,
  Action,
  Connection,
  Connections,
  getActionOutputCount,
} from "@/lib/action-schema/action-types";
import type { SwitchActionConfig } from "@/lib/action-schema/configs/control-flow-actions";
import {
  CanvasNode,
  CanvasEdge,
  CanvasNodeData,
  CanvasEdgeData,
  getNodeType,
  ConnectionValidationResult,
  ConnectionAttempt,
} from "./canvas-types";
import {
  getActionTypeColor,
  getConnectionColor,
  getConnectionStyle,
  hexToRgba,
} from "./canvas-config";

// ============================================================================
// Workflow to React Flow Conversion
// ============================================================================

/**
 * Convert workflow to React Flow format
 */
export function workflowToReactFlow(workflow: Workflow): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
} {
  console.log("[workflowToReactFlow] Converting workflow:", {
    workflowId: workflow.id,
    workflowName: workflow.name,
    actionsCount: workflow.actions.length,
    actions: workflow.actions,
    connections: workflow.connections,
  });

  const nodes = actionsToNodes(workflow.actions);
  const edges = connectionsToEdges(
    workflow.connections || {},
    workflow.actions
  );

  console.log("[workflowToReactFlow] Result:", {
    nodesCount: nodes.length,
    edgesCount: edges.length,
    nodes,
    edges,
  });

  return { nodes, edges };
}

/**
 * Convert actions to React Flow nodes
 */
function actionsToNodes(actions: Action[]): CanvasNode[] {
  console.log("[actionsToNodes] Converting actions:", actions);

  return actions.map((action, index) => {
    const nodeType = getNodeType(action);
    const color = getActionTypeColor(action.type);

    // Provide default position if not set (new actions in unified builder)
    const position = action.position
      ? { x: action.position[0], y: action.position[1] }
      : { x: 100 + index * 250, y: 100 }; // Default horizontal layout

    console.log("[actionsToNodes] Action:", {
      id: action.id,
      type: action.type,
      position: action.position,
      defaultedPosition: position,
      nodeType,
      color,
    });

    const node: CanvasNode = {
      id: action.id,
      type: nodeType,
      position,
      data: {
        action,
        selected: false,
        executionState: "idle",
        label: action.name || action.type,
      } as CanvasNodeData,
      style: {
        backgroundColor: hexToRgba(color, 0.1),
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 180,
      },
    };

    console.log("[actionsToNodes] Created node:", node);
    return node;
  });
}

/**
 * Convert connections to React Flow edges
 */
function connectionsToEdges(
  connections: Connections,
  actions: Action[]
): CanvasEdge[] {
  const edges: CanvasEdge[] = [];

  Object.entries(connections).forEach(([sourceActionId, outputs]) => {
    // Process each connection type (main, error, success, parallel)
    (["main", "error", "success", "parallel"] as const).forEach((connType) => {
      const connectionArray = outputs[connType as keyof typeof outputs];
      if (!connectionArray) return;

      // Process each output index
      connectionArray.forEach(
        (outputConnections: unknown, outputIndex: number) => {
          // Process each connection from this output
          const conns = outputConnections as Array<{ action: string }>;
          conns.forEach((conn, connIndex: number) => {
            const edgeId = `${sourceActionId}-${connType}-${outputIndex}-${conn.action}-${connIndex}`;
            const color = getConnectionColor(connType);
            const style = getConnectionStyle(connType);

            // Get label based on connection type and output index
            const label = getEdgeLabel(
              sourceActionId,
              outputIndex,
              connType,
              actions
            );

            const edge: CanvasEdge = {
              id: edgeId,
              source: sourceActionId,
              target: conn.action,
              sourceHandle: `${connType}-${outputIndex}`,
              targetHandle: "input-0",
              type: "custom",
              animated: false,
              data: {
                connection: conn,
                connectionType: connType,
                outputIndex,
                label,
                selected: false,
                animated: false,
              } as CanvasEdgeData,
              style: {
                ...style,
                stroke: color,
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: color,
                width: 20,
                height: 20,
              },
            };

            edges.push(edge);
          });
        }
      );
    });
  });

  return edges;
}

/**
 * Get edge label based on connection type and output index
 */
function getEdgeLabel(
  sourceActionId: string,
  outputIndex: number,
  connType: "main" | "error" | "success" | "parallel",
  actions: Action[]
): string | undefined {
  const sourceAction = actions.find((a) => a.id === sourceActionId);
  if (!sourceAction) return undefined;

  // Special labels for control flow actions
  switch (sourceAction.type) {
    case "IF":
      return outputIndex === 0 ? "true" : "false";
    case "TRY_CATCH":
      return connType === "error" ? "catch" : "try";
    case "SWITCH": {
      const switchConfig = sourceAction.config as SwitchActionConfig;
      if (switchConfig.cases && outputIndex < switchConfig.cases.length) {
        const caseValue = switchConfig.cases[outputIndex];
        return String(caseValue);
      }
      return "default";
    }
    case "LOOP":
      return connType === "main" ? "loop" : undefined;
    default:
      // Connection type labels for non-control flow
      if (connType === "error") return "error";
      if (connType === "success") return "success";
      if (connType === "parallel") return "parallel";
      return undefined;
  }
}

// ============================================================================
// React Flow to Workflow Conversion
// ============================================================================

/**
 * Convert React Flow format back to workflow
 */
export function reactFlowToWorkflow(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  workflowId: string,
  workflowName: string
): Workflow {
  const actions = nodesToActions(nodes);
  const connections = edgesToConnections(edges);

  return {
    id: workflowId,
    name: workflowName,
    version: "1.0.0",
    format: "graph",
    actions,
    connections,
  };
}

/**
 * Convert React Flow nodes back to actions
 */
function nodesToActions(nodes: CanvasNode[]): Action[] {
  return nodes.map((node) => {
    const action = node.data.action;
    return {
      ...action,
      position: [node.position.x, node.position.y],
    };
  });
}

/**
 * Convert React Flow edges back to connections
 */
function edgesToConnections(edges: CanvasEdge[]): Connections {
  const connections: Connections = {};

  edges.forEach((edge) => {
    const sourceId = edge.source;
    const targetId = edge.target;

    // Parse sourceHandle to determine connection type and output index
    // Format: "main-0", "error-0", etc.
    let connType: "main" | "error" | "success" | "parallel" = "main";
    let outputIndex = 0;

    if (edge.data?.connectionType && edge.data?.outputIndex !== undefined) {
      // Use existing data if available
      connType = edge.data.connectionType;
      outputIndex = edge.data.outputIndex;
    } else if (edge.sourceHandle) {
      // Parse sourceHandle for newly created edges
      const parts = edge.sourceHandle.split("-");
      if (parts.length >= 2 && parts[1]) {
        const handleType = parts[0];
        const handleIndex = parseInt(parts[1], 10);

        // Map handle type to connection type
        if (
          handleType === "error" ||
          handleType === "success" ||
          handleType === "parallel"
        ) {
          connType = handleType;
        } else {
          connType = "main";
        }

        outputIndex = isNaN(handleIndex) ? 0 : handleIndex;
      }
    }

    // Initialize source if needed
    if (!connections[sourceId]) {
      connections[sourceId] = {};
    }

    // Initialize connection type array if needed
    const sourceConnections = connections[sourceId];
    if (!sourceConnections[connType as keyof typeof sourceConnections]) {
      (sourceConnections[
        connType as keyof typeof sourceConnections
      ] as Connection[][]) = [];
    }

    // Initialize output index array if needed
    const connArray = sourceConnections[
      connType as keyof typeof sourceConnections
    ] as Connection[][];
    while (connArray.length <= outputIndex) {
      connArray.push([]);
    }

    // Add connection
    connArray[outputIndex]?.push({
      action: targetId,
      type: connType,
      index: 0, // Always 0 for now (single input per action)
    });
  });

  return connections;
}

// ============================================================================
// Connection Validation
// ============================================================================

/**
 * Validate a connection attempt
 */
export function validateConnection(
  attempt: ConnectionAttempt,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): ConnectionValidationResult {
  const sourceNode = nodes.find((n) => n.id === attempt.source);
  const targetNode = nodes.find((n) => n.id === attempt.target);

  if (!sourceNode || !targetNode) {
    return {
      valid: false,
      message: "Source or target node not found",
    };
  }

  // Prevent self-connections
  if (attempt.source === attempt.target) {
    return {
      valid: false,
      message: "Cannot connect a node to itself",
      suggestion: "Choose a different target node",
    };
  }

  // Check if connection would create a cycle
  if (wouldCreateCycle(attempt, edges)) {
    return {
      valid: false,
      message: "This connection would create a cycle",
      suggestion: "Cycles are not allowed in workflows",
    };
  }

  // Validate output count
  const sourceAction = sourceNode.data.action;
  const outputCount = getActionOutputCount(
    sourceAction.type,
    sourceAction.config
  );
  const handleParts = attempt.sourceHandle?.split("-");
  const outputIndex = handleParts ? parseInt(handleParts[1] || "0") : 0;

  if (outputIndex >= outputCount) {
    return {
      valid: false,
      message: `Action ${sourceAction.type} only has ${outputCount} output(s)`,
    };
  }

  // Check for duplicate connections
  const isDuplicate = edges.some(
    (e) =>
      e.source === attempt.source &&
      e.target === attempt.target &&
      e.sourceHandle === attempt.sourceHandle
  );

  if (isDuplicate) {
    return {
      valid: false,
      message: "This connection already exists",
    };
  }

  return { valid: true };
}

/**
 * Check if a connection would create a cycle
 */
function wouldCreateCycle(
  attempt: ConnectionAttempt,
  edges: CanvasEdge[]
): boolean {
  // Build adjacency list
  const adjacency = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    adjacency.get(edge.source)!.push(edge.target);
  });

  // Add the proposed edge
  if (!adjacency.has(attempt.source)) {
    adjacency.set(attempt.source, []);
  }
  adjacency.get(attempt.source)!.push(attempt.target);

  // DFS to detect cycle
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

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (hasCycle(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  // Check from the source of the new connection
  return hasCycle(attempt.source);
}

// ============================================================================
// Layout Utilities
// ============================================================================

/**
 * Auto-fit viewport to show all nodes
 */
export function fitViewport(
  nodes: CanvasNode[],
  containerWidth: number,
  containerHeight: number,
  padding: number = 50
): { x: number; y: number; zoom: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  // Calculate bounding box of all nodes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const nodeWidth = 200; // Default width
    const nodeHeight = 80; // Default height

    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + nodeWidth);
    maxY = Math.max(maxY, node.position.y + nodeHeight);
  });

  const width = maxX - minX;
  const height = maxY - minY;

  // Calculate zoom to fit
  const scaleX = (containerWidth - padding * 2) / width;
  const scaleY = (containerHeight - padding * 2) / height;
  const zoom = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

  // Calculate center position
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const x = containerWidth / 2 - centerX * zoom;
  const y = containerHeight / 2 - centerY * zoom;

  return { x, y, zoom };
}

/**
 * Auto-arrange nodes in a hierarchical layout
 * Simple top-to-bottom layout based on action depths
 */
export function autoLayout(workflow: Workflow): Action[] {
  const { actions, connections } = workflow;

  // Calculate depths (distance from entry points)
  const depths = calculateDepths(actions, connections);

  // Group actions by depth
  const depthGroups = new Map<number, Action[]>();
  actions.forEach((action) => {
    const depth = depths.get(action.id) || 0;
    if (!depthGroups.has(depth)) {
      depthGroups.set(depth, []);
    }
    depthGroups.get(depth)!.push(action);
  });

  // Layout each depth level
  const verticalSpacing = 150;
  const horizontalSpacing = 250;
  const startY = 100;
  const startX = 100;

  const updatedActions: Action[] = [];

  Array.from(depthGroups.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([depth, actionsInDepth]) => {
      const y = startY + depth * verticalSpacing;
      const totalWidth = (actionsInDepth.length - 1) * horizontalSpacing;
      const offsetX = startX - totalWidth / 2;

      actionsInDepth.forEach((action, index) => {
        const x = offsetX + index * horizontalSpacing;
        updatedActions.push({
          ...action,
          position: [x, y],
        });
      });
    });

  return updatedActions;
}

/**
 * Calculate depth of each action (distance from entry points)
 */
function calculateDepths(
  actions: Action[],
  connections: Connections
): Map<string, number> {
  const depths = new Map<string, number>();
  const visited = new Set<string>();

  // Find entry points (actions with no incoming connections)
  const hasIncoming = new Set<string>();
  Object.values(connections).forEach((outputs) => {
    ["main", "error", "success", "parallel"].forEach((type) => {
      const conns = outputs[type as keyof typeof outputs];
      if (conns) {
        conns.forEach((outputConns) => {
          outputConns.forEach((conn) => {
            hasIncoming.add(conn.action);
          });
        });
      }
    });
  });

  const entryPoints = actions
    .map((a) => a.id)
    .filter((id) => !hasIncoming.has(id));

  // BFS to calculate depths
  const queue: Array<{ id: string; depth: number }> = entryPoints.map((id) => ({
    id,
    depth: 0,
  }));

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;

    if (visited.has(id)) continue;
    visited.add(id);
    depths.set(id, depth);

    // Get all outgoing connections
    const outputs = connections[id];
    if (outputs) {
      ["main", "error", "success", "parallel"].forEach((type) => {
        const conns = outputs[type as keyof typeof outputs];
        if (conns) {
          conns.forEach((outputConns) => {
            outputConns.forEach((conn) => {
              queue.push({ id: conn.action, depth: depth + 1 });
            });
          });
        }
      });
    }
  }

  // Set depth 0 for any orphaned actions
  actions.forEach((action) => {
    if (!depths.has(action.id)) {
      depths.set(action.id, 0);
    }
  });

  return depths;
}

// ============================================================================
// Node Utilities
// ============================================================================

/**
 * Get all selected nodes
 */
export function getSelectedNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter((n) => n.selected || n.data.selected);
}

/**
 * Get node by ID
 */
export function getNodeById(
  nodes: CanvasNode[],
  id: string
): CanvasNode | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * Update node position
 */
export function updateNodePosition(
  nodes: CanvasNode[],
  nodeId: string,
  position: { x: number; y: number }
): CanvasNode[] {
  return nodes.map((node) =>
    node.id === nodeId ? { ...node, position } : node
  );
}

/**
 * Update node data
 */
export function updateNodeData(
  nodes: CanvasNode[],
  nodeId: string,
  data: Partial<CanvasNodeData>
): CanvasNode[] {
  return nodes.map((node) =>
    node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
  );
}

// ============================================================================
// Edge Utilities
// ============================================================================

/**
 * Get all edges connected to a node
 */
export function getConnectedEdges(
  edges: CanvasEdge[],
  nodeId: string
): CanvasEdge[] {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId);
}

/**
 * Get incoming edges for a node
 */
export function getIncomingEdges(
  edges: CanvasEdge[],
  nodeId: string
): CanvasEdge[] {
  return edges.filter((e) => e.target === nodeId);
}

/**
 * Get outgoing edges for a node
 */
export function getOutgoingEdges(
  edges: CanvasEdge[],
  nodeId: string
): CanvasEdge[] {
  return edges.filter((e) => e.source === nodeId);
}

/**
 * Update edge animation state
 */
export function updateEdgeAnimation(
  edges: CanvasEdge[],
  edgeId: string,
  animated: boolean
): CanvasEdge[] {
  return edges.map((edge) =>
    edge.id === edgeId
      ? { ...edge, animated, data: { ...edge.data, animated } }
      : edge
  );
}
