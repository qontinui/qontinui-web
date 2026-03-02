"use client";

import { RefObject } from "react";
import { WorkflowCanvas } from "@/components/workflow-canvas/WorkflowCanvas";
import { NodePalette } from "@/components/workflow-canvas/NodePalette";
import { Workflow, Action, ActionType } from "@/lib/action-schema/action-types";

interface CanvasPanelProps {
  workflow: Workflow;
  canvasRef: RefObject<HTMLDivElement | null>;
  onWorkflowChange: (workflow: Workflow) => void;
  onNodeClick: (action: Action) => void;
  onNodeAdd: (nodeType: ActionType) => void;
}

export function CanvasPanel({
  workflow,
  canvasRef,
  onWorkflowChange,
  onNodeClick,
  onNodeAdd,
}: CanvasPanelProps) {
  return (
    <div
      className="flex-1 min-h-0 flex relative"
      ref={canvasRef}
      data-tutorial-id="graph-canvas"
    >
      <div
        className="absolute left-0 top-0 bottom-0 z-10 w-80"
        data-tutorial-id="node-palette-panel"
      >
        <NodePalette
          position="left"
          showSearch={true}
          showRecent={true}
          showFavorites={true}
          onNodeAdd={onNodeAdd}
          canvasRef={canvasRef}
        />
      </div>

      <div className="flex-1">
        <WorkflowCanvas
          workflow={workflow}
          onWorkflowChange={onWorkflowChange}
          onNodeClick={onNodeClick}
          skipProvider={true}
          settings={{
            showGrid: true,
            showMinimap: true,
            showControls: true,
            snapToGrid: true,
            gridSize: 15,
          }}
        />
      </div>
    </div>
  );
}
