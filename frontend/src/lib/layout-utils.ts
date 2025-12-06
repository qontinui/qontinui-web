import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

export interface LayoutOptions {
  direction?: "TB" | "LR" | "BT" | "RL"; // Top-Bottom, Left-Right, Bottom-Top, Right-Left
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSep?: number; // Separation between nodes
  rankSep?: number; // Separation between ranks/levels
}

const defaultOptions: Required<LayoutOptions> = {
  direction: "TB",
  nodeWidth: 200,
  nodeHeight: 150,
  nodeSep: 50,
  rankSep: 100,
};

/**
 * Apply hierarchical layout to nodes using dagre
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const opts = { ...defaultOptions, ...options };

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: opts.direction,
    nodesep: opts.nodeSep,
    ranksep: opts.rankSep,
  });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    return {
      ...node,
      position: {
        x: Math.round(nodeWithPosition.x - opts.nodeWidth / 2),
        y: Math.round(nodeWithPosition.y - opts.nodeHeight / 2),
      },
    };
  });

  return {
    nodes: layoutedNodes,
    edges,
  };
}

/**
 * Apply grid layout to nodes
 */
export function getGridLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  columns: number = 4,
  nodeWidth: number = 200,
  nodeHeight: number = 150,
  spacingX: number = 50,
  spacingY: number = 50
): { nodes: Node[]; edges: Edge[] } {
  const layoutedNodes = nodes.map((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);

    return {
      ...node,
      position: {
        x: Math.round(col * (nodeWidth + spacingX) + 100),
        y: Math.round(row * (nodeHeight + spacingY) + 100),
      },
    };
  });

  return {
    nodes: layoutedNodes,
    edges,
  };
}
