/**
 * GraphEditor Component
 *
 * Wrapper around WorkflowCanvas providing a consistent interface for graph-based
 * workflow editing. Integrates NodePalette and handles workflow prop mapping.
 * Matches the interface style of SequentialEditor for consistency.
 */

import React, { useCallback } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { WorkflowCanvas } from '@/components/workflow-canvas'
import { NodePalette } from '@/components/workflow-canvas/NodePalette'
import type { Workflow, Action, Connection, ActionType } from '@/lib/action-schema/action-types'
import type { GraphEditorProps } from '../types'

function GraphEditorInner({
  workflow,
  selectedNode,
  onSelectNode,
  onUpdateWorkflow,
  onAddNode,
}: GraphEditorProps) {
  /**
   * Handle workflow changes from canvas
   */
  const handleWorkflowChange = useCallback(
    (updatedWorkflow: Workflow) => {
      onUpdateWorkflow(updatedWorkflow)
    },
    [onUpdateWorkflow]
  )

  /**
   * Handle node clicks - select the action
   */
  const handleNodeClick = useCallback(
    (action: Action) => {
      onSelectNode(action)
    },
    [onSelectNode]
  )

  /**
   * Handle edge clicks - currently just logs
   * TODO: Implement edge property editing if needed
   */
  const handleEdgeClick = useCallback(
    (connection: Connection) => {
      console.log('[GraphEditor] Edge clicked:', connection)
    },
    []
  )

  /**
   * Handle adding new nodes from palette
   */
  const handleNodeAdd = useCallback(
    (nodeType: ActionType) => {
      console.log('[GraphEditor] Adding node:', nodeType)
      onAddNode(nodeType)
    },
    [onAddNode]
  )

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
      <div className="flex-1">
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
    </div>
  )
}

export function GraphEditor(props: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  )
}
