import dagre from "dagre";
import { useMemo } from "react";
import { Position, type Node, type Edge } from "@xyflow/react";

interface LayoutOptions {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSep?: number;
  rankSep?: number;
}

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 80;
const DEFAULT_NODE_SEP = 40;
const DEFAULT_RANK_SEP = 60;

function getLayoutedNodes(
  nodes: Node[],
  edges: Edge[],
  options?: LayoutOptions
): Node[] {
  if (nodes.length === 0) return [];

  const direction = options?.direction ?? "TB";
  const nodeWidth = options?.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options?.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const nodeSep = options?.nodeSep ?? DEFAULT_NODE_SEP;
  const rankSep = options?.rankSep ?? DEFAULT_RANK_SEP;

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: nodeSep,
    ranksep: rankSep,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const isHorizontal = direction === "LR";

  return nodes.map((node) => {
    const dagreNode = graph.node(node.id);

    return {
      ...node,
      position: {
        x: dagreNode.x - nodeWidth / 2,
        y: dagreNode.y - nodeHeight / 2,
      },
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
    };
  });
}

export function useGraphLayout(
  nodes: Node[],
  edges: Edge[],
  options?: LayoutOptions
): { nodes: Node[]; edges: Edge[] } {
  const layoutedNodes = useMemo(
    () => getLayoutedNodes(nodes, edges, options),
    [nodes, edges, options]
  );

  return { nodes: layoutedNodes, edges };
}
