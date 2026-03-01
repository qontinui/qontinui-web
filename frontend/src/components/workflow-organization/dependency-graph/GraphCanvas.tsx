/**
 * Graph Canvas Component
 *
 * The ReactFlow canvas rendering area, including Background, Controls, MiniMap,
 * legend panel, and context menu overlay.
 */

"use client";

import React, { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FileText, GitBranch, TrendingUp, Target } from "lucide-react";
import { GraphCanvasProps } from "./types";
import { WorkflowNodeComponent } from "./NodeRenderer";

export function GraphCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  contextMenu,
  onCloseContextMenu,
  onOpenWorkflow,
  onShowDependencies,
  onShowDependents,
  onCenterOnNode,
  children,
}: GraphCanvasProps) {
  // Custom node types - memoized to prevent unnecessary re-registration
  const nodeTypes = useMemo(
    () => ({
      workflow: WorkflowNodeComponent,
    }),
    []
  );

  return (
    <div className="flex-1 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange as (changes: unknown[]) => void}
        onEdgesChange={onEdgesChange as (changes: unknown[]) => void}
        onNodeClick={onNodeClick as NodeMouseHandler}
        onNodeDoubleClick={onNodeDoubleClick as NodeMouseHandler}
        onNodeContextMenu={onNodeContextMenu as NodeMouseHandler}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
        }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          style={{ backgroundColor: "hsl(var(--muted))" }}
        />

        {/* Controls (passed as children, rendered inside ReactFlow for Panel support) */}
        {children}

        {/* Legend */}
        <Panel position="bottom-left" className="m-2">
          <div className="bg-background/95 backdrop-blur-sm p-3 rounded-lg shadow-lg border space-y-2">
            <div className="text-xs font-medium mb-2">Legend</div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded border-2 border-green-500 bg-green-50 dark:bg-green-950" />
              <span>Leaf (no dependencies)</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-50 dark:bg-blue-950" />
              <span>Normal</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded border-2 border-red-500 bg-red-50 dark:bg-red-950" />
              <span>Circular dependency</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded border-2 border-border-default bg-surface-canvas dark:bg-surface-canvas" />
              <span>Unused</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            role="button"
            tabIndex={0}
            onClick={onCloseContextMenu}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCloseContextMenu();
              }
            }}
          />
          <div
            className="fixed z-50 bg-popover rounded-md shadow-lg border p-1 min-w-[200px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
              onClick={() => {
                onOpenWorkflow(contextMenu.workflowId);
                onCloseContextMenu();
              }}
            >
              <FileText className="h-4 w-4" />
              Open Workflow
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
              onClick={() => {
                onShowDependencies(contextMenu.workflowId);
                onCloseContextMenu();
              }}
            >
              <GitBranch className="h-4 w-4" />
              Show Dependencies
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
              onClick={() => {
                onShowDependents(contextMenu.workflowId);
                onCloseContextMenu();
              }}
            >
              <TrendingUp className="h-4 w-4" />
              Show Dependents
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
              onClick={() => {
                onCenterOnNode();
                onCloseContextMenu();
              }}
            >
              <Target className="h-4 w-4" />
              Center on Node
            </button>
          </div>
        </>
      )}
    </div>
  );
}
