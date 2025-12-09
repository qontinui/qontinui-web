/**
 * GraphEditor Component
 *
 * Wrapper around WorkflowCanvas providing a consistent interface for graph-based
 * workflow editing. Integrates NodePalette and handles workflow prop mapping.
 * Matches the interface style of SequentialEditor for consistency.
 */

import React, { useCallback, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import { NodePalette } from "@/components/workflow-canvas/NodePalette";
import type {
  Workflow,
  Action,
  Connection,
  ActionType,
} from "@/lib/action-schema/action-types";
import type { EdgeInfo } from "@/components/workflow-canvas";
import { EdgePropertiesPanel } from "./EdgePropertiesPanel";
import type { GraphEditorProps } from "../types";

function GraphEditorInner({
  workflow,
  onSelectNode,
  onUpdateWorkflow,
  onAddNode,
}: GraphEditorProps) {
  // Track selected edge for property editing
  const [selectedEdge, setSelectedEdge] = useState<EdgeInfo | null>(null);

  /**
   * Handle workflow changes from canvas
   */
  const handleWorkflowChange = useCallback(
    (updatedWorkflow: Workflow) => {
      onUpdateWorkflow(updatedWorkflow);
    },
    [onUpdateWorkflow]
  );

  /**
   * Handle node clicks - select the action, clear edge selection
   */
  const handleNodeClick = useCallback(
    (action: Action) => {
      setSelectedEdge(null);
      onSelectNode(action);
    },
    [onSelectNode]
  );

  /**
   * Handle edge clicks - select edge for property editing
   */
  const handleEdgeClick = useCallback(
    (edgeInfo: EdgeInfo) => {
      console.log("[GraphEditor] Edge clicked:", edgeInfo);
      setSelectedEdge(edgeInfo);
      onSelectNode(null); // Deselect any node
    },
    [onSelectNode]
  );

  /**
   * Handle edge property updates
   */
  const handleEdgeUpdate = useCallback(
    (updatedConnection: Connection) => {
      if (!selectedEdge) return;

      // Deep clone the connections object
      const newConnections = JSON.parse(JSON.stringify(workflow.connections));

      // Navigate to the correct connection and update it
      const sourceConnections = newConnections[selectedEdge.sourceId];
      if (sourceConnections) {
        const outputArray = sourceConnections[selectedEdge.outputType];
        if (
          outputArray &&
          outputArray[selectedEdge.outputIndex] &&
          outputArray[selectedEdge.outputIndex][selectedEdge.connectionIndex]
        ) {
          outputArray[selectedEdge.outputIndex][selectedEdge.connectionIndex] =
            updatedConnection;

          const updatedWorkflow = {
            ...workflow,
            connections: newConnections,
          };
          onUpdateWorkflow(updatedWorkflow);

          // Update selected edge with new connection data
          setSelectedEdge({
            ...selectedEdge,
            connection: updatedConnection,
          });
        }
      }
    },
    [selectedEdge, workflow, onUpdateWorkflow]
  );

  /**
   * Close edge properties panel
   */
  const handleCloseEdgePanel = useCallback(() => {
    setSelectedEdge(null);
  }, []);

  /**
   * Handle adding new nodes from palette
   */
  const handleNodeAdd = useCallback(
    (nodeType: ActionType) => {
      console.log("[GraphEditor] handleNodeAdd called with:", nodeType);
      console.log(
        "[GraphEditor] Current workflow has",
        workflow.actions.length,
        "actions"
      );
      onAddNode(nodeType);
      console.log("[GraphEditor] onAddNode completed");
    },
    [onAddNode, workflow.actions.length]
  );

  return (
    <div className="flex h-full w-full">
      {/* Node Palette */}
      <div className="w-64 border-r border-gray-800 bg-gray-950">
        <NodePalette
          position="left"
          collapsible={false}
          showSearch={true}
          showRecent={true}
          showFavorites={true}
          onNodeAdd={handleNodeAdd}
        />
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <WorkflowCanvas
          workflow={workflow}
          onWorkflowChange={handleWorkflowChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          readonly={false}
          skipProvider={true}
          settings={{
            showGrid: true,
            showMinimap: true,
            showControls: true,
            snapToGrid: true,
            gridSize: 20,
            minZoom: 0.1,
            maxZoom: 2,
            defaultZoom: 1,
            panOnScroll: false,
            keyboardShortcuts: true,
            nodesSelectable: true,
            edgesSelectable: true,
          }}
        />
      </div>

      {/* Edge Properties Panel - slides in from right when edge is selected */}
      {selectedEdge && (
        <div className="w-80 flex-shrink-0 border-l border-gray-800">
          <EdgePropertiesPanel
            edge={selectedEdge}
            onUpdate={handleEdgeUpdate}
            onClose={handleCloseEdgePanel}
          />
        </div>
      )}
    </div>
  );
}

export function GraphEditor(props: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}
