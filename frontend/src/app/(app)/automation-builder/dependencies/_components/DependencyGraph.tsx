"use client";

import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import type { DependencyGraph as DependencyGraphData } from "@/services/workflow-dependency-analyzer";
import { getNodeColor } from "../dependencies-types";

interface DependencyGraphProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  graph: DependencyGraphData;
}

export function DependencyGraph({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  graph,
}: DependencyGraphProps) {
  return (
    <div className="flex-1 relative border-r">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        attributionPosition="bottom-left"
        className="bg-background"
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const depNode = graph.nodes.get(node.id);
            return depNode ? getNodeColor(depNode) : "#3b82f6";
          }}
          className="bg-background border"
        />
        <Panel
          position="top-right"
          className="bg-background border rounded-lg p-3 m-4 space-y-2"
        >
          <div className="text-xs font-semibold mb-2">Legend</div>
          <div className="flex items-center gap-2 text-xs">
            <div className="size-3 rounded bg-[#3b82f6]" />
            <span>Normal</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="size-3 rounded bg-[#10b981]" />
            <span>Unused</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="size-3 rounded bg-[#f59e0b]" />
            <span>Critical</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="size-3 rounded bg-[#ef4444]" />
            <span>Circular</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
