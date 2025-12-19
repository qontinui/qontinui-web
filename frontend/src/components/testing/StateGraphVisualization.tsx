"use client";

import { useMemo } from "react";
import { useStateGraph } from "@/hooks/useTesting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

interface StateGraphVisualizationProps {
  projectId: string;
  workflowId: string;
}

interface StateNodeData {
  label: string;
  visit_count: number;
  success_rate: number;
}

// Custom node component for state nodes
function StateNode({ data }: { data: StateNodeData }) {
  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return "border-green-500 bg-green-500/20";
    if (rate >= 70) return "border-yellow-500 bg-yellow-500/20";
    return "border-red-500 bg-red-500/20";
  };

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-[#1A1A1B] ${getSuccessRateColor(data.success_rate)} min-w-[150px]`}
    >
      <div className="font-medium text-white mb-1">{data.label}</div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{data.visit_count} visits</span>
        <span
          className={
            data.success_rate >= 90
              ? "text-green-500"
              : data.success_rate >= 70
                ? "text-yellow-500"
                : "text-red-500"
          }
        >
          {data.success_rate.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

const nodeTypes = {
  stateNode: StateNode,
};

export function StateGraphVisualization({
  projectId,
  workflowId,
}: StateGraphVisualizationProps) {
  const {
    data: graphData,
    isLoading,
    error,
  } = useStateGraph(projectId, workflowId);

  // Convert graph data to ReactFlow format and apply layout
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!graphData) {
      return { initialNodes: [], initialEdges: [] };
    }

    // Create dagre graph for layout
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 150 });

    // Add nodes to dagre
    graphData.nodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: 200, height: 80 });
    });

    // Add edges to dagre
    graphData.edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    // Calculate layout
    dagre.layout(dagreGraph);

    // Convert to ReactFlow format with positions
    const nodes: Node[] = graphData.nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
        id: node.id,
        type: "stateNode",
        position: {
          x: nodeWithPosition.x - 100,
          y: nodeWithPosition.y - 40,
        },
        data: {
          label: node.label,
          visit_count: node.visit_count,
          success_rate: node.success_rate,
        },
      };
    });

    const edges: Edge[] = graphData.edges.map((edge) => {
      const getEdgeColor = (rate: number) => {
        if (rate >= 90) return "#10b981"; // green-500
        if (rate >= 70) return "#eab308"; // yellow-500
        return "#ef4444"; // red-500
      };

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: `${edge.label} (${edge.success_rate.toFixed(0)}%)`,
        animated: edge.success_rate < 70,
        style: {
          stroke: getEdgeColor(edge.success_rate),
          strokeWidth: 2,
        },
        labelStyle: {
          fill: "#fff",
          fontSize: 12,
        },
        labelBgStyle: {
          fill: "#1A1A1B",
          fillOpacity: 0.8,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: getEdgeColor(edge.success_rate),
        },
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [graphData]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading state graph...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">
            Error loading state graph: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>State Graph</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">No state graph data available</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>State Transition Graph</CardTitle>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-gray-400">90%+ success</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-gray-400">70-90% success</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-gray-400">&lt;70% success</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ height: "600px", width: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
            className="bg-[#0A0A0B] rounded-lg"
          >
            <Background color="#333" gap={16} />
            <Controls className="bg-[#1A1A1B] border border-gray-700" />
            <MiniMap
              className="bg-[#1A1A1B] border border-gray-700"
              nodeColor={(node) => {
                const rate = node.data.success_rate as number;
                if (rate >= 90) return "#10b981";
                if (rate >= 70) return "#eab308";
                return "#ef4444";
              }}
            />
          </ReactFlow>
        </div>

        {/* Graph Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="text-center p-3 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Total States</div>
            <div className="text-2xl font-bold text-[#00D9FF]">
              {graphData.nodes.length}
            </div>
          </div>
          <div className="text-center p-3 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Total Transitions</div>
            <div className="text-2xl font-bold text-[#BD00FF]">
              {graphData.edges.length}
            </div>
          </div>
          <div className="text-center p-3 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Avg Success Rate</div>
            <div className="text-2xl font-bold text-[#00FF88]">
              {(
                graphData.edges.reduce(
                  (acc, edge) => acc + edge.success_rate,
                  0
                ) / graphData.edges.length
              ).toFixed(1)}
              %
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
