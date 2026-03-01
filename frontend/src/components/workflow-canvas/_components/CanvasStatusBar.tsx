/**
 * Canvas Status Bar - Bottom-left panel showing node/edge counts and selection
 */

"use client";

import React from "react";
import { Panel } from "@xyflow/react";
import { CanvasNode } from "../canvas-types";

export interface CanvasStatusBarProps {
  nodeCount: number;
  edgeCount: number;
  selectedNode: CanvasNode | null;
}

export function CanvasStatusBar({
  nodeCount,
  edgeCount,
  selectedNode,
}: CanvasStatusBarProps) {
  return (
    <Panel position="bottom-left" className="workflow-canvas-panel">
      <div className="text-xs text-text-muted">
        <div>Nodes: {nodeCount}</div>
        <div>Edges: {edgeCount}</div>
        {selectedNode && <div>Selected: {selectedNode.data.action.type}</div>}
      </div>
    </Panel>
  );
}
