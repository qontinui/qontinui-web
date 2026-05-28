"use client";

import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  Panel,
  OnNodesChange,
  OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Check, Trash2, CheckSquare } from "lucide-react";

interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
  selectedCount: number;
  accepting: boolean;
  onAcceptAll: () => void;
  onAcceptSelected: () => void;
  onDiscard: () => void;
}

export function FlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onEdgeClick,
  selectedCount,
  accepting,
  onAcceptAll,
  onAcceptSelected,
  onDiscard,
}: FlowCanvasProps) {
  return (
    <div className="flex-1 border rounded-lg overflow-hidden bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        fitView
      >
        <Background />
        <Controls />
        <Panel
          position="top-left"
          className="bg-white p-4 rounded-lg shadow-lg"
        >
          <div className="space-y-2">
            <h3 className="font-semibold">Legend</h3>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 border-2 border-blue-500 rounded" />
              <span>High Confidence</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 border-2 border-yellow-500 rounded" />
              <span>Medium Confidence</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 border-2 border-red-500 rounded" />
              <span>Low Confidence</span>
            </div>
          </div>
        </Panel>
        <Panel position="top-right" className="space-x-2">
          <Button onClick={onAcceptAll} disabled={accepting} size="sm">
            <Check className="mr-2 h-4 w-4" />
            Accept All
          </Button>
          <Button
            onClick={onAcceptSelected}
            disabled={accepting || selectedCount === 0}
            variant="outline"
            size="sm"
          >
            <CheckSquare className="mr-2 h-4 w-4" />
            Accept Selected ({selectedCount})
          </Button>
          <DestructiveButton onClick={onDiscard} size="sm">
            <Trash2 className="mr-2 h-4 w-4" />
            Discard
          </DestructiveButton>
        </Panel>
      </ReactFlow>
    </div>
  );
}
