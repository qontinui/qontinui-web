"use client";

/**
 * State Machine Graph Visualization
 *
 * Renders discovered states and transitions as an interactive directed graph
 * using @xyflow/react + dagre layout. Works with the StateDiscoveryResult types.
 */

import { useMemo, useEffect, useCallback } from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { DiscoveredState, StateTransition } from "@/types/state-machine";

interface StateMachineGraphProps {
  states: DiscoveredState[];
  transitions: StateTransition[];
  onStateClick?: (stateId: string) => void;
  height?: number;
}

// ============================================================================
// Custom Node
// ============================================================================

interface StateNodeData {
  label: string;
  confidence: number;
  elementCount: number;
  [key: string]: unknown;
}

function StateNode({ data }: { data: StateNodeData }) {
  const getColor = () => {
    if (data.confidence >= 0.8)
      return "bg-green-100 border-green-400 text-green-900";
    if (data.confidence >= 0.5)
      return "bg-blue-100 border-blue-400 text-blue-900";
    return "bg-gray-100 border-gray-400 text-gray-900";
  };

  return (
    <div
      className={`px-4 py-2.5 rounded-lg border-2 shadow-sm text-center min-w-[120px] cursor-pointer hover:shadow-md transition-shadow ${getColor()}`}
    >
      <div className="font-medium text-xs leading-tight">{data.label}</div>
      <div className="text-[10px] mt-0.5 opacity-70">
        {data.elementCount} elements &middot;{" "}
        {Math.round(data.confidence * 100)}%
      </div>
    </div>
  );
}

const nodeTypes = { stateNode: StateNode };

// ============================================================================
// Layout
// ============================================================================

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = "TB"
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 100, nodesep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 160, height: 60 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - 80, y: pos.y - 30 } };
  });

  return { nodes: layoutedNodes, edges };
}

// ============================================================================
// Component
// ============================================================================

export function StateMachineGraph({
  states,
  transitions,
  onStateClick,
  height = 450,
}: StateMachineGraphProps) {
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const nodes: Node[] = states.map((state) => ({
      id: state.id,
      type: "stateNode",
      position: { x: 0, y: 0 },
      data: {
        label: state.name,
        confidence: state.confidence,
        elementCount: state.elementIds.length,
      } satisfies StateNodeData,
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = transitions
      .filter((t) => nodeIds.has(t.fromStateId) && nodeIds.has(t.toStateId))
      .map((t) => ({
        id: t.id,
        source: t.fromStateId,
        target: t.toStateId,
        label: t.trigger?.type ?? "",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: {
          strokeWidth: Math.max(1, t.confidence * 3),
          opacity: Math.max(0.4, t.confidence),
        },
        labelStyle: { fontSize: 10, fill: "#666" },
      }));

    if (nodes.length > 0) {
      return getLayoutedElements(nodes, edges);
    }
    return { nodes, edges };
  }, [states, transitions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
  }, [layoutedNodes, setNodes]);
  useEffect(() => {
    setEdges(layoutedEdges);
  }, [layoutedEdges, setEdges]);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      onStateClick?.(node.id);
    },
    [onStateClick]
  );

  if (states.length === 0) {
    return (
      <div className="text-sm text-text-muted text-center py-12">
        No states discovered yet
      </div>
    );
  }

  return (
    <div style={{ height }} className="overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={0.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
