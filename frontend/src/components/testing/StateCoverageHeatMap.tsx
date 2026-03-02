"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  StateCoverageHeatMapProps,
  StateNodeData,
} from "./StateCoverageHeatMap.types";
import { useStateCoverageHeatMap } from "./_hooks/useStateCoverageHeatMap";
import { coverageNodeTypes } from "./_components/CoverageStateNode";
import { CoverageStatsPanel } from "./_components/CoverageStatsPanel";
import { CoverageLegend } from "./_components/CoverageLegend";
import { CoverageProgressBar } from "./_components/CoverageProgressBar";
import { NodeDetailsDialog } from "./_components/NodeDetailsDialog";

function getMiniMapNodeColor(node: { data: Record<string, unknown> }): string {
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
}

export function StateCoverageHeatMap({
  projectId,
  workflowId,
}: StateCoverageHeatMapProps) {
  const {
    graphData,
    isLoading,
    error,
    coverageStats,
    initialNodes,
    initialEdges,
    selectedNode,
    handleNodeClick,
    clearSelectedNode,
  } = useStateCoverageHeatMap(projectId, workflowId);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

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
            <CoverageLegend />
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
              nodeTypes={coverageNodeTypes}
              fitView
              attributionPosition="bottom-left"
              className="bg-surface-canvas rounded-lg"
            >
              <Background color="#333" gap={16} />
              <Controls className="bg-surface-raised border border-border-default" />
              <MiniMap
                className="bg-surface-raised border border-border-default"
                nodeColor={getMiniMapNodeColor}
              />
              {coverageStats && <CoverageStatsPanel stats={coverageStats} />}
            </ReactFlow>
          </div>
          {coverageStats && <CoverageProgressBar stats={coverageStats} />}
        </CardContent>
      </Card>

      <NodeDetailsDialog
        selectedNode={selectedNode}
        onClose={clearSelectedNode}
      />
    </>
  );
}
