/**
 * Execution Visualization Utilities
 *
 * Utilities for visualizing workflow execution on the canvas:
 * - Update node visual state during execution
 * - Highlight current executing action
 * - Show completion/failure states
 * - Animate flow through connections
 * - Progress indicators
 */

import type { Node, Edge } from "@xyflow/react";
import type { CanvasNode, CanvasEdge } from "./canvas-types";
import type { ActionExecutionStatus } from "@/services/backend-api";

// ============================================================================
// Colors and Styles
// ============================================================================

/**
 * Execution state colors
 */
export const EXECUTION_COLORS = {
  idle: {
    border: "#6b7280", // gray-500
    background: "#374151", // gray-700
    text: "#d1d5db", // gray-300
  },
  pending: {
    border: "#6b7280", // gray-500
    background: "#374151", // gray-700
    text: "#d1d5db", // gray-300
  },
  running: {
    border: "#3b82f6", // blue-500
    background: "#1e40af", // blue-800
    text: "#ffffff",
    glow: "0 0 12px rgba(59, 130, 246, 0.6)",
  },
  completed: {
    border: "#10b981", // green-500
    background: "#065f46", // green-800
    text: "#ffffff",
  },
  failed: {
    border: "#ef4444", // red-500
    background: "#991b1b", // red-800
    text: "#ffffff",
  },
  skipped: {
    border: "#6b7280", // gray-500
    background: "#1f2937", // gray-800
    text: "#9ca3af", // gray-400
  },
};

/**
 * Edge animation colors
 */
export const EDGE_COLORS = {
  default: "#6b7280", // gray-500
  active: "#3b82f6", // blue-500
  success: "#10b981", // green-500
  error: "#ef4444", // red-500
};

// ============================================================================
// Node Visualization
// ============================================================================

/**
 * Update node visual state based on execution status
 */
export function updateNodeExecutionState(
  node: Node,
  status: ActionExecutionStatus,
  options: {
    showGlow?: boolean;
    showBadge?: boolean;
    animate?: boolean;
  } = {}
): Node {
  const { showGlow = true, showBadge = true, animate = true } = options;

  const colors = EXECUTION_COLORS[status];
  const canvasNode = node as CanvasNode;

  // Update node style
  const style = {
    ...canvasNode.style,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    boxShadow: showGlow && status === "running" && "glow" in colors ? colors.glow : undefined,
    transition: animate ? "all 0.3s ease-in-out" : undefined,
  };

  // Update node data
  const data = {
    ...canvasNode.data,
    executionStatus: status,
    showExecutionBadge: showBadge,
  };

  return {
    ...node,
    style,
    data,
  };
}

/**
 * Batch update nodes with execution states
 */
export function updateNodesExecutionState(
  nodes: Node[],
  actionStates: Record<string, ActionExecutionStatus>,
  options?: {
    showGlow?: boolean;
    showBadge?: boolean;
    animate?: boolean;
  }
): Node[] {
  return nodes.map((node) => {
    const status = actionStates[node.id];
    if (!status) {
      return node;
    }
    return updateNodeExecutionState(node, status, options);
  });
}

/**
 * Reset node to default visual state
 */
export function resetNodeExecutionState(node: Node): Node {
  return updateNodeExecutionState(node, "idle", {
    showGlow: false,
    showBadge: false,
    animate: false,
  });
}

/**
 * Reset all nodes to default state
 */
export function resetNodesExecutionState(nodes: Node[]): Node[] {
  return nodes.map(resetNodeExecutionState);
}

/**
 * Highlight a node (e.g., current executing action)
 */
export function highlightNode(node: Node, highlight: boolean): Node {
  const canvasNode = node as CanvasNode;

  if (highlight) {
    return {
      ...node,
      style: {
        ...canvasNode.style,
        borderWidth: 3,
        boxShadow: "0 0 16px rgba(59, 130, 246, 0.8)",
        transform: "scale(1.05)",
        transition: "all 0.2s ease-in-out",
      },
      data: {
        ...canvasNode.data,
        highlighted: true,
      },
    };
  } else {
    return {
      ...node,
      style: {
        ...canvasNode.style,
        borderWidth: 2,
        boxShadow: undefined,
        transform: "scale(1)",
      },
      data: {
        ...canvasNode.data,
        highlighted: false,
      },
    };
  }
}

// ============================================================================
// Edge Visualization
// ============================================================================

/**
 * Update edge visual state
 */
export function updateEdgeExecutionState(
  edge: Edge,
  active: boolean,
  status?: "success" | "error"
): Edge {
  const canvasEdge = edge as CanvasEdge;

  const strokeColor = active
    ? status === "error"
      ? EDGE_COLORS.error
      : status === "success"
        ? EDGE_COLORS.success
        : EDGE_COLORS.active
    : EDGE_COLORS.default;

  return {
    ...edge,
    animated: active,
    style: {
      ...canvasEdge.style,
      stroke: strokeColor,
      strokeWidth: active ? 2.5 : 1.5,
      opacity: active ? 1 : 0.5,
    },
    data: {
      ...canvasEdge.data,
      executionActive: active,
      executionStatus: status,
    },
  };
}

/**
 * Batch update edges based on execution flow
 */
export function updateEdgesExecutionFlow(
  edges: Edge[],
  currentActionId: string | null,
  completedActionIds: Set<string>
): Edge[] {
  return edges.map((edge) => {
    // Highlight edges from current action
    if (currentActionId && edge.source === currentActionId) {
      return updateEdgeExecutionState(edge, true);
    }

    // Show completed edges
    if (
      completedActionIds.has(edge.source) &&
      completedActionIds.has(edge.target)
    ) {
      return updateEdgeExecutionState(edge, false, "success");
    }

    // Default state
    return updateEdgeExecutionState(edge, false);
  });
}

/**
 * Reset edge to default state
 */
export function resetEdgeExecutionState(edge: Edge): Edge {
  return updateEdgeExecutionState(edge, false);
}

/**
 * Reset all edges to default state
 */
export function resetEdgesExecutionState(edges: Edge[]): Edge[] {
  return edges.map(resetEdgeExecutionState);
}

// ============================================================================
// Progress Visualization
// ============================================================================

/**
 * Calculate execution progress
 */
export function calculateExecutionProgress(
  totalActions: number,
  completedActions: number,
  failedActions: number,
  skippedActions: number
): {
  percentage: number;
  completed: number;
  remaining: number;
  failed: number;
  skipped: number;
} {
  const completed = completedActions;
  const failed = failedActions;
  const skipped = skippedActions;
  const total = totalActions;
  const remaining = total - completed - failed - skipped;
  const percentage =
    total > 0 ? ((completed + failed + skipped) / total) * 100 : 0;

  return {
    percentage,
    completed,
    remaining,
    failed,
    skipped,
  };
}

/**
 * Get progress color based on status
 */
export function getProgressColor(
  completedActions: number,
  failedActions: number,
  totalActions: number
): string {
  if (failedActions > 0) {
    return EDGE_COLORS.error;
  }
  if (completedActions === totalActions) {
    return EDGE_COLORS.success;
  }
  return EDGE_COLORS.active;
}

// ============================================================================
// Execution Path Visualization
// ============================================================================

/**
 * Trace execution path from start to current action
 */
export function traceExecutionPath(
  edges: Edge[],
  executionOrder: string[]
): Set<string> {
  const pathEdges = new Set<string>();

  for (let i = 0; i < executionOrder.length - 1; i++) {
    const source = executionOrder[i];
    const target = executionOrder[i + 1];

    // Find edge connecting these actions
    const edge = edges.find((e) => e.source === source && e.target === target);
    if (edge) {
      pathEdges.add(edge.id);
    }
  }

  return pathEdges;
}

/**
 * Highlight execution path
 */
export function highlightExecutionPath(
  edges: Edge[],
  pathEdgeIds: Set<string>
): Edge[] {
  return edges.map((edge) => {
    if (pathEdgeIds.has(edge.id)) {
      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: EDGE_COLORS.success,
          strokeWidth: 2,
          opacity: 0.8,
        },
        data: {
          ...edge.data,
          inExecutionPath: true,
        },
      };
    }
    return edge;
  });
}

// ============================================================================
// Animation Utilities
// ============================================================================

/**
 * Animate node pulse effect
 */
export function createPulseAnimation(
  node: Node,
  duration: number = 1000
): Node {
  return {
    ...node,
    style: {
      ...node.style,
      animation: `pulse ${duration}ms ease-in-out infinite`,
    },
  };
}

/**
 * Animate edge flow
 */
export function animateEdgeFlow(edge: Edge, speed: number = 1): Edge {
  return {
    ...edge,
    animated: true,
    style: {
      ...edge.style,
      animationDuration: `${1000 / speed}ms`,
    },
  };
}

/**
 * Create ripple effect on node
 */
export function createRippleEffect(nodeId: string): void {
  // This would trigger a CSS animation or use a library like framer-motion
  const element = document.querySelector(`[data-id="${nodeId}"]`);
  if (element) {
    element.classList.add("ripple-effect");
    setTimeout(() => {
      element.classList.remove("ripple-effect");
    }, 1000);
  }
}

// ============================================================================
// Execution Status Badge
// ============================================================================

/**
 * Get status badge configuration
 */
export function getStatusBadge(status: ActionExecutionStatus): {
  label: string;
  color: string;
  icon: string;
} {
  switch (status) {
    case "idle":
      return { label: "Idle", color: "#6b7280", icon: "○" };
    case "pending":
      return { label: "Pending", color: "#6b7280", icon: "⋯" };
    case "running":
      return { label: "Running", color: "#3b82f6", icon: "▶" };
    case "completed":
      return { label: "Completed", color: "#10b981", icon: "✓" };
    case "failed":
      return { label: "Failed", color: "#ef4444", icon: "✗" };
    case "skipped":
      return { label: "Skipped", color: "#6b7280", icon: "→" };
    default:
      return { label: "Unknown", color: "#6b7280", icon: "?" };
  }
}

// ============================================================================
// Viewport Management
// ============================================================================

/**
 * Center viewport on a node
 */
export function centerViewportOnNode(
  nodeId: string,
  reactFlowInstance: any,
  options: {
    zoom?: number;
    duration?: number;
  } = {}
): void {
  const { zoom = 1, duration = 300 } = options;

  reactFlowInstance.fitView({
    nodes: [{ id: nodeId }],
    duration,
    padding: 0.5,
    maxZoom: zoom,
  });
}

/**
 * Follow execution (auto-center on current action)
 */
export function followExecution(
  currentActionId: string,
  reactFlowInstance: any,
  enabled: boolean
): void {
  if (!enabled || !currentActionId) {
    return;
  }

  centerViewportOnNode(currentActionId, reactFlowInstance, {
    zoom: 1.2,
    duration: 500,
  });
}

// ============================================================================
// Performance Metrics Visualization
// ============================================================================

/**
 * Calculate action execution time statistics
 */
export function calculateActionTimeStats(
  actionStates: Record<string, { duration?: number }>
): {
  min: number;
  max: number;
  average: number;
  total: number;
  count: number;
} {
  const durations = Object.values(actionStates)
    .filter((state) => state.duration !== undefined)
    .map((state) => state.duration!);

  if (durations.length === 0) {
    return { min: 0, max: 0, average: 0, total: 0, count: 0 };
  }

  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const total = durations.reduce((sum, d) => sum + d, 0);
  const average = total / durations.length;

  return { min, max, average, total, count: durations.length };
}

/**
 * Get relative speed indicator for an action
 */
export function getSpeedIndicator(
  duration: number,
  averageDuration: number
): "fast" | "normal" | "slow" {
  const ratio = duration / averageDuration;

  if (ratio < 0.5) return "fast";
  if (ratio > 2) return "slow";
  return "normal";
}

// ============================================================================
// CSS Injection (for animations)
// ============================================================================

/**
 * Inject execution visualization CSS
 */
export function injectExecutionCSS(): void {
  if (typeof document === "undefined") return;

  const styleId = "execution-visualization-styles";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.8;
        transform: scale(1.02);
      }
    }

    @keyframes ripple {
      0% {
        box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
      }
      100% {
        box-shadow: 0 0 0 20px rgba(59, 130, 246, 0);
      }
    }

    .ripple-effect {
      animation: ripple 1s ease-out;
    }

    .execution-glow {
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.6);
    }

    .execution-pulse {
      animation: pulse 1s ease-in-out infinite;
    }
  `;

  document.head.appendChild(style);
}
