"use client";

/**
 * Recording State Graph
 *
 * Compact graph visualization of states and transitions discovered
 * from a recording session. Uses @xyflow/react + dagre layout.
 */

import { useMemo, useCallback, useEffect } from "react";
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
import type { PipelineDiscoveryResult } from "@/hooks/useUIBridgeRecording";

interface RecordingStateGraphProps {
  result: PipelineDiscoveryResult;
  height?: number;
}

// ============================================================================
// Custom Node
// ============================================================================

interface StateNodeData {
  label: string;
  confidence: number;
  elementCount: number;
  isGlobal: boolean;
  isBlocking: boolean;
  [key: string]: unknown;
}

function StateNode({ data }: { data: StateNodeData }) {
  const getColor = () => {
    if (data.isBlocking) return "bg-amber-100 border-amber-400 text-amber-900";
    if (data.isGlobal) return "bg-slate-100 border-slate-400 text-slate-700";
    if (data.confidence >= 0.8) return "bg-green-100 border-green-400 text-green-900";
    if (data.confidence >= 0.5) return "bg-blue-100 border-blue-400 text-blue-900";
    return "bg-gray-100 border-gray-400 text-gray-900";
  };

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 shadow-sm text-center min-w-[100px] ${getColor()}`}
    >
      <div className="font-medium text-xs leading-tight">{data.label}</div>
      <div className="text-[10px] mt-0.5 opacity-70">
        {Math.round(data.confidence * 100)}%
        {data.isBlocking ? " · modal" : ""}
        {data.isGlobal ? " · global" : ""}
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
  direction = "TB",
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 140, height: 56 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - 70,
        y: pos.y - 28,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ============================================================================
// Component
// ============================================================================

export function RecordingStateGraph({
  result,
  height = 300,
}: RecordingStateGraphProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    // Build nodes from states (skip global states)
    const nodes: Node[] = result.states
      .filter((s) => !s.isGlobal)
      .map((state) => ({
        id: state.id,
        type: "stateNode",
        position: { x: 0, y: 0 },
        data: {
          label: state.name,
          confidence: state.confidence,
          elementCount: state.elementCount,
          isGlobal: state.isGlobal,
          isBlocking: state.isBlocking,
        } satisfies StateNodeData,
      }));

    // Build edges from transitions
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = [];
    for (const t of result.transitions) {
      for (const from of t.fromStates) {
        for (const to of t.activateStates) {
          if (nodeIds.has(from) && nodeIds.has(to)) {
            edges.push({
              id: `${t.id}-${from}-${to}`,
              source: from,
              target: to,
              label: `${Math.round(t.confidence * 100)}%`,
              markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
              style: {
                strokeWidth: Math.max(1, t.confidence * 3),
                opacity: Math.max(0.3, t.confidence),
              },
              labelStyle: { fontSize: 10, fill: "#666" },
            });
          }
        }
      }
    }

    // Layout
    if (nodes.length > 0) {
      return getLayoutedElements(nodes, edges);
    }
    return { nodes, edges };
  }, [result]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);

  // Update when result changes (useNodesState only uses initial value once)
  useEffect(() => { setNodes(initialNodes ?? []); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(initialEdges ?? []); }, [initialEdges, setEdges]);

  const onInit = useCallback(() => {
    // Auto-fit on init handled by ReactFlow
  }, []);

  if (!result.states.length) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        No states discovered
      </div>
    );
  }

  return (
    <div style={{ height }} className="border rounded-md overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={0.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
