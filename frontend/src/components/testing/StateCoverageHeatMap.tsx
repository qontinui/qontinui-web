"use client";

import { useMemo, useState } from "react";
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
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StateCoverageHeatMapProps {
  projectId: string;
  workflowId: string;
}

interface StateNodeData {
  label: string;
  visit_count: number;
  success_rate: number;
  covered: boolean;
  status: "passing" | "partial" | "failing" | "uncovered";
}

interface NodeExecutionDetails {
  stateName: string;
  visitCount: number;
  successRate: number;
  status: string;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
}

// Custom node component for state nodes with coverage coloring
function CoverageStateNode({ data }: { data: StateNodeData }) {
  const getNodeStyle = (status: StateNodeData["status"]) => {
    switch (status) {
      case "passing":
        return "border-green-500 bg-green-500/20 shadow-green-500/50";
      case "partial":
        return "border-yellow-500 bg-yellow-500/20 shadow-yellow-500/50";
      case "failing":
        return "border-red-500 bg-red-500/20 shadow-red-500/50";
      case "uncovered":
        return "border-border-default bg-border-default/10 shadow-border-default/30";
    }
  };

  const getStatusIcon = (status: StateNodeData["status"]) => {
    switch (status) {
      case "passing":
        return "✓";
      case "partial":
        return "⚠";
      case "failing":
        return "✗";
      case "uncovered":
        return "○";
    }
  };

  const getTextColor = (status: StateNodeData["status"]) => {
    switch (status) {
      case "passing":
        return "text-green-400";
      case "partial":
        return "text-yellow-400";
      case "failing":
        return "text-red-400";
      case "uncovered":
        return "text-text-muted";
    }
  };

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-surface-raised ${getNodeStyle(data.status)} min-w-[160px] shadow-lg cursor-pointer hover:scale-105 transition-transform`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-white">{data.label}</div>
        <div
          className={`text-lg font-bold ${getTextColor(data.status)}`}
          title={data.status}
        >
          {getStatusIcon(data.status)}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          {data.covered ? `${data.visit_count} visits` : "Not tested"}
        </span>
        {data.covered && (
          <span className={getTextColor(data.status)}>
            {data.success_rate.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  coverageStateNode: CoverageStateNode,
};

export function StateCoverageHeatMap({
  projectId,
  workflowId,
}: StateCoverageHeatMapProps) {
  const [selectedNode, setSelectedNode] = useState<NodeExecutionDetails | null>(
    null
  );

  const {
    data: graphData,
    isLoading,
    error,
  } = useStateGraph(projectId, workflowId);

  // Categorize nodes and calculate coverage statistics
  const coverageStats = useMemo(() => {
    if (!graphData) return null;

    const passingNodes = graphData.nodes.filter(
      (n) => n.visit_count > 0 && n.success_rate >= 90
    ).length;
    const partialNodes = graphData.nodes.filter(
      (n) => n.visit_count > 0 && n.success_rate >= 70 && n.success_rate < 90
    ).length;
    const failingNodes = graphData.nodes.filter(
      (n) => n.visit_count > 0 && n.success_rate < 70
    ).length;
    const uncoveredNodes = graphData.nodes.filter(
      (n) => n.visit_count === 0
    ).length;

    return {
      passing: passingNodes,
      partial: partialNodes,
      failing: failingNodes,
      uncovered: uncoveredNodes,
      total: graphData.nodes.length,
    };
  }, [graphData]);

  // Convert graph data to ReactFlow format with coverage coloring
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

    // Convert to ReactFlow format with positions and coverage status
    const nodes: Node[] = graphData.nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const covered = node.visit_count > 0;
      let status: StateNodeData["status"];

      if (!covered) {
        status = "uncovered";
      } else if (node.success_rate >= 90) {
        status = "passing";
      } else if (node.success_rate >= 70) {
        status = "partial";
      } else {
        status = "failing";
      }

      return {
        id: node.id,
        type: "coverageStateNode",
        position: {
          x: nodeWithPosition.x - 100,
          y: nodeWithPosition.y - 40,
        },
        data: {
          label: node.label,
          visit_count: node.visit_count,
          success_rate: node.success_rate,
          covered,
          status,
        },
      };
    });

    const edges: Edge[] = graphData.edges.map((edge) => {
      const covered = edge.attempt_count > 0;

      const getEdgeColor = (rate: number, covered: boolean) => {
        if (!covered) return "var(--color-border-subtle)"; // gray-600
        if (rate >= 90) return "#10b981"; // green-500
        if (rate >= 70) return "#eab308"; // yellow-500
        return "#ef4444"; // red-500
      };

      const getEdgeWidth = (covered: boolean, attemptCount: number) => {
        if (!covered) return 1;
        // Scale width based on attempt count (1-5 range)
        return Math.min(1 + Math.log10(attemptCount + 1) * 2, 5);
      };

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: covered
          ? `${edge.label} (${edge.success_rate.toFixed(0)}%)`
          : edge.label,
        animated: covered && edge.success_rate < 70,
        style: {
          stroke: getEdgeColor(edge.success_rate, covered),
          strokeWidth: getEdgeWidth(covered, edge.attempt_count),
          strokeDasharray: covered ? "0" : "5, 5",
        },
        labelStyle: {
          fill: covered ? "#fff" : "#888",
          fontSize: 12,
        },
        labelBgStyle: {
          fill: "var(--color-surface-raised)",
          fillOpacity: 0.9,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: getEdgeColor(edge.success_rate, covered),
        },
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [graphData]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    const nodeData = node.data as unknown as StateNodeData;
    const graphNode = graphData?.nodes.find((n) => n.id === node.id);

    if (!graphNode) return;

    const successfulAttempts = Math.round(
      (graphNode.visit_count * graphNode.success_rate) / 100
    );
    const failedAttempts = graphNode.visit_count - successfulAttempts;

    setSelectedNode({
      stateName: nodeData.label,
      visitCount: nodeData.visit_count,
      successRate: nodeData.success_rate,
      status: nodeData.status,
      totalAttempts: graphNode.visit_count,
      successfulAttempts,
      failedAttempts,
    });
  };

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-12 text-center">
          <div className="text-text-muted">Loading coverage heat map...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">
            Error loading coverage heat map: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle>State Coverage Heat Map</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="text-text-muted">
            No state coverage data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>State Coverage Heat Map</CardTitle>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-text-muted">Passing (90%+)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-text-muted">Partial (70-90%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-text-muted">Failing (&lt;70%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-border-default" />
                <span className="text-text-muted">Not Tested</span>
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
              onNodeClick={handleNodeClick}
              nodeTypes={nodeTypes}
              fitView
              attributionPosition="bottom-left"
              className="bg-surface-canvas rounded-lg"
            >
              <Background color="#333" gap={16} />
              <Controls className="bg-surface-raised border border-border-default" />
              <MiniMap
                className="bg-surface-raised border border-border-default"
                nodeColor={(node) => {
                  const status = (node.data as unknown as StateNodeData).status;
                  switch (status) {
                    case "passing":
                      return "#10b981";
                    case "partial":
                      return "#eab308";
                    case "failing":
                      return "#ef4444";
                    case "uncovered":
                      return "var(--color-border-subtle)";
                  }
                }}
              />
              <Panel
                position="top-right"
                className="bg-surface-raised/90 p-4 rounded-lg border border-border-default"
              >
                <div className="text-xs text-text-muted mb-2">
                  Coverage Breakdown
                </div>
                {coverageStats && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-green-500 text-xs">Passing:</span>
                      <span className="text-white font-medium text-xs">
                        {coverageStats.passing}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-yellow-500 text-xs">Partial:</span>
                      <span className="text-white font-medium text-xs">
                        {coverageStats.partial}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-red-500 text-xs">Failing:</span>
                      <span className="text-white font-medium text-xs">
                        {coverageStats.failing}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-text-muted text-xs">Untested:</span>
                      <span className="text-white font-medium text-xs">
                        {coverageStats.uncovered}
                      </span>
                    </div>
                    <div className="border-t border-border-default my-2" />
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-text-muted text-xs">Total:</span>
                      <span className="text-white font-bold text-xs">
                        {coverageStats.total}
                      </span>
                    </div>
                  </div>
                )}
              </Panel>
            </ReactFlow>
          </div>

          {/* Overall Coverage Percentage */}
          {coverageStats && (
            <div className="mt-6 p-4 bg-surface-canvas/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-muted">
                  Overall Coverage
                </span>
                <span className="text-2xl font-bold text-brand-primary">
                  {(
                    ((coverageStats.total - coverageStats.uncovered) /
                      coverageStats.total) *
                    100
                  ).toFixed(1)}
                  %
                </span>
              </div>
              <div className="h-3 bg-surface-raised rounded-full overflow-hidden">
                <div className="h-full flex">
                  <div
                    className="bg-green-500"
                    style={{
                      width: `${(coverageStats.passing / coverageStats.total) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-yellow-500"
                    style={{
                      width: `${(coverageStats.partial / coverageStats.total) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-red-500"
                    style={{
                      width: `${(coverageStats.failing / coverageStats.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Node Details Dialog */}
      <Dialog
        open={selectedNode !== null}
        onOpenChange={(open) => !open && setSelectedNode(null)}
      >
        <DialogContent className="bg-surface-raised border-border-subtle">
          <DialogHeader>
            <DialogTitle className="text-white">
              {selectedNode?.stateName}
            </DialogTitle>
            <DialogDescription className="text-text-muted">
              Execution details and statistics
            </DialogDescription>
          </DialogHeader>
          {selectedNode && (
            <div className="space-y-4">
              {/* Status Badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-muted">Status:</span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    selectedNode.status === "passing"
                      ? "bg-green-500/20 text-green-500"
                      : selectedNode.status === "partial"
                        ? "bg-yellow-500/20 text-yellow-500"
                        : selectedNode.status === "failing"
                          ? "bg-red-500/20 text-red-500"
                          : "bg-border-default/20 text-text-muted"
                  }`}
                >
                  {selectedNode.status.toUpperCase()}
                </span>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-surface-canvas/50 rounded-lg">
                  <div className="text-xs text-text-muted mb-1">
                    Total Visits
                  </div>
                  <div className="text-2xl font-bold text-brand-primary">
                    {selectedNode.totalAttempts}
                  </div>
                </div>
                <div className="p-3 bg-surface-canvas/50 rounded-lg">
                  <div className="text-xs text-text-muted mb-1">
                    Success Rate
                  </div>
                  <div className="text-2xl font-bold text-brand-success">
                    {selectedNode.successRate.toFixed(1)}%
                  </div>
                </div>
                <div className="p-3 bg-surface-canvas/50 rounded-lg">
                  <div className="text-xs text-text-muted mb-1">Successful</div>
                  <div className="text-2xl font-bold text-green-500">
                    {selectedNode.successfulAttempts}
                  </div>
                </div>
                <div className="p-3 bg-surface-canvas/50 rounded-lg">
                  <div className="text-xs text-text-muted mb-1">Failed</div>
                  <div className="text-2xl font-bold text-red-500">
                    {selectedNode.failedAttempts}
                  </div>
                </div>
              </div>

              {/* Success/Failure Breakdown */}
              {selectedNode.totalAttempts > 0 && (
                <div>
                  <div className="text-sm text-text-muted mb-2">
                    Execution Breakdown
                  </div>
                  <div className="h-6 bg-surface-raised rounded-full overflow-hidden flex">
                    <div
                      className="bg-green-500 flex items-center justify-center text-xs font-medium text-white"
                      style={{
                        width: `${(selectedNode.successfulAttempts / selectedNode.totalAttempts) * 100}%`,
                      }}
                    >
                      {selectedNode.successfulAttempts > 0 &&
                        `${((selectedNode.successfulAttempts / selectedNode.totalAttempts) * 100).toFixed(0)}%`}
                    </div>
                    <div
                      className="bg-red-500 flex items-center justify-center text-xs font-medium text-white"
                      style={{
                        width: `${(selectedNode.failedAttempts / selectedNode.totalAttempts) * 100}%`,
                      }}
                    >
                      {selectedNode.failedAttempts > 0 &&
                        `${((selectedNode.failedAttempts / selectedNode.totalAttempts) * 100).toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
