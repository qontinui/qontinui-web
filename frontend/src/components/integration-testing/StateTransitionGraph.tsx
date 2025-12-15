// components/integration-testing/StateTransitionGraph.tsx

"use client";

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type {
  StateCoverageMetrics,
  StateTransition,
} from "@/types/integration-testing";

interface StateTransitionGraphProps {
  stateMetrics: Record<string, StateCoverageMetrics>;
  transitions: StateTransition[];
  onStateClick?: (stateName: string) => void;
  onTransitionClick?: (transition: StateTransition) => void;
}

/**
 * Custom node component for state visualization
 */
function StateNode({ data }: { data: unknown }) {
  const coverage = data.coverage || 0;

  // Determine node color based on coverage
  const getNodeColor = () => {
    if (coverage === 0) return "bg-red-100 border-red-400 text-red-900";
    if (coverage < 50) return "bg-yellow-100 border-yellow-400 text-yellow-900";
    if (coverage < 100) return "bg-blue-100 border-blue-400 text-blue-900";
    return "bg-green-100 border-green-400 text-green-900";
  };

  return (
    <div
      className={`
        px-4 py-3 rounded-lg border-2 shadow-md hover:shadow-lg transition-shadow
        ${getNodeColor()}
      `}
    >
      <div className="font-semibold text-sm">{data.label}</div>
      <div className="text-xs mt-1 opacity-75">
        {coverage.toFixed(0)}% coverage
      </div>
      {data.actions > 0 && (
        <div className="text-xs mt-0.5 opacity-75">{data.actions} actions</div>
      )}
    </div>
  );
}

const nodeTypes = {
  stateNode: StateNode,
};

/**
 * Layout nodes using Dagre for hierarchical positioning
 */
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = "TB") {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 100, nodesep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 180, height: 80 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 90,
        y: nodeWithPosition.y - 40,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function StateTransitionGraph({
  stateMetrics,
  transitions,
  onStateClick,
  onTransitionClick,
}: StateTransitionGraphProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    // Create nodes from state metrics
    const nodes: Node[] = Object.values(stateMetrics).map((metric) => ({
      id: metric.state_name,
      type: "stateNode",
      data: {
        label: metric.state_name,
        coverage: metric.coverage_percentage,
        actions: metric.actions_performed,
        screenshots: metric.screenshot_count,
      },
      position: { x: 0, y: 0 }, // Will be set by layout
    }));

    // Create edges from transitions
    const edges: Edge[] = transitions.map((transition, index) => ({
      id: `${transition.from_state}-${transition.to_state}-${index}`,
      source: transition.from_state,
      target: transition.to_state,
      type: "smoothstep",
      animated: transition.covered,
      style: {
        stroke: transition.covered ? "#10b981" : "#9ca3af",
        strokeWidth: Math.min(2 + transition.count / 2, 6),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: transition.covered ? "#10b981" : "#9ca3af",
      },
      label: transition.count > 1 ? `${transition.count}x` : undefined,
      labelStyle: {
        fontSize: 10,
        fontWeight: 600,
      },
      labelBgStyle: {
        fill: "#fff",
      },
      data: transition as unknown as Record<string, unknown>,
    }));

    // Apply dagre layout
    return getLayoutedElements(nodes, edges, "TB");
  }, [stateMetrics, transitions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when data changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = (_event: React.MouseEvent, node: Node) => {
    onStateClick?.(node.id);
  };

  const onEdgeClick = (_event: React.MouseEvent, edge: Edge) => {
    if (edge.data) {
      onTransitionClick?.(edge.data as unknown as StateTransition);
    }
  };

  if (nodes.length === 0) {
    return (
      <div className="h-96 flex items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">No state transitions found</p>
          <p className="text-sm mt-1">
            Execute a process to visualize state transitions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[600px] border rounded-lg bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white p-3 rounded-lg shadow-lg border border-gray-200">
        <div className="text-xs font-semibold text-gray-700 mb-2">Legend</div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-100 border-2 border-green-400 rounded"></div>
            <span>100% Coverage</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-100 border-2 border-blue-400 rounded"></div>
            <span>50-99% Coverage</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-yellow-100 border-2 border-yellow-400 rounded"></div>
            <span>&lt;50% Coverage</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-100 border-2 border-red-400 rounded"></div>
            <span>Uncovered</span>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-gray-200 mt-1">
            <div className="w-8 h-0.5 bg-green-500"></div>
            <span>Covered Transition</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-gray-400"></div>
            <span>Missing Transition</span>
          </div>
        </div>
      </div>
    </div>
  );
}
