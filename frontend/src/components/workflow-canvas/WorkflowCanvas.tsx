/**
 * Workflow Canvas - Main React Flow canvas component
 *
 * Provides a visual graph editor for workflows with drag-and-drop,
 * connections, validation, and keyboard shortcuts.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection as ReactFlowConnection,
  addEdge,
  useNodesState,
  useEdgesState,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  NodeChange,
  EdgeChange,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Workflow, Action, Connection } from '@/lib/action-schema/action-types';
import {
  CanvasNode,
  CanvasEdge,
  CanvasSettings,
  DEFAULT_CANVAS_SETTINGS,
  ConnectionAttempt,
} from './canvas-types';
import {
  workflowToReactFlow,
  reactFlowToWorkflow,
  validateConnection,
  fitViewport,
  autoLayout,
} from './canvas-utils';
import { CustomEdge } from './CustomEdge';
import { DefaultNode } from './nodes/DefaultNode';
import { GRID_CONFIG, ZOOM_CONFIG, COLORS } from './canvas-config';
import './WorkflowCanvas.css';

// ============================================================================
// Props
// ============================================================================

export interface WorkflowCanvasProps {
  /** Workflow to display */
  workflow: Workflow;

  /** Callback when workflow changes */
  onWorkflowChange: (workflow: Workflow) => void;

  /** Read-only mode (no editing) */
  readonly?: boolean;

  /** Callback when a node is clicked */
  onNodeClick?: (action: Action) => void;

  /** Callback when an edge is clicked */
  onEdgeClick?: (connection: Connection) => void;

  /** Canvas settings */
  settings?: Partial<CanvasSettings>;

  /** Additional CSS class */
  className?: string;

  /** Container style */
  style?: React.CSSProperties;
}

// ============================================================================
// Node Type Registry
// ============================================================================

const nodeTypes = {
  default: DefaultNode,
  find: DefaultNode,
  mouse: DefaultNode,
  keyboard: DefaultNode,
  control_flow: DefaultNode,
  data: DefaultNode,
  state: DefaultNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

// ============================================================================
// Main Component (Inner - with React Flow context)
// ============================================================================

function WorkflowCanvasInner({
  workflow,
  onWorkflowChange,
  readonly = false,
  onNodeClick,
  onEdgeClick,
  settings: userSettings,
  className = '',
  style = {},
}: WorkflowCanvasProps) {
  const reactFlowInstance = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  // Merge user settings with defaults
  const settings = useMemo(
    () => ({ ...DEFAULT_CANVAS_SETTINGS, ...userSettings }),
    [userSettings]
  );

  // Convert workflow to React Flow format
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => workflowToReactFlow(workflow),
    [workflow]
  );

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);

  // Update nodes/edges when workflow changes externally
  useEffect(() => {
    console.log('[WorkflowCanvas] Workflow changed:', {
      id: workflow.id,
      name: workflow.name,
      actionsCount: workflow.actions.length,
      actions: workflow.actions
    });

    const { nodes: newNodes, edges: newEdges } = workflowToReactFlow(workflow);

    console.log('[WorkflowCanvas] Converted to React Flow format:', {
      nodesCount: newNodes.length,
      edgesCount: newEdges.length,
      nodes: newNodes
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [workflow.id, workflow.actions.length]); // Watch actions.length instead of version

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle node changes (position, selection, etc.)
   */
  const handleNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readonly) return;

      onNodesChange(changes);

      // Update workflow if positions changed
      const positionChanges = changes.filter((c) => c.type === 'position');
      if (positionChanges.length > 0) {
        // Debounce workflow update
        setTimeout(() => {
          const updatedWorkflow = reactFlowToWorkflow(
            nodes,
            edges,
            workflow.id,
            workflow.name
          );
          onWorkflowChange(updatedWorkflow);
        }, 100);
      }
    },
    [readonly, onNodesChange, nodes, edges, workflow.id, workflow.name, onWorkflowChange]
  );

  /**
   * Handle edge changes (selection, deletion, etc.)
   */
  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readonly) return;

      onEdgesChange(changes);

      // Update workflow if edges were removed
      const removals = changes.filter((c) => c.type === 'remove');
      if (removals.length > 0) {
        setTimeout(() => {
          const updatedWorkflow = reactFlowToWorkflow(
            nodes,
            edges,
            workflow.id,
            workflow.name
          );
          onWorkflowChange(updatedWorkflow);
        }, 50);
      }
    },
    [readonly, onEdgesChange, nodes, edges, workflow.id, workflow.name, onWorkflowChange]
  );

  /**
   * Handle new connection
   */
  const handleConnect: OnConnect = useCallback(
    (connection: ReactFlowConnection) => {
      if (readonly) return;

      // Validate connection
      const attempt: ConnectionAttempt = {
        source: connection.source!,
        sourceHandle: connection.sourceHandle,
        target: connection.target!,
        targetHandle: connection.targetHandle,
      };

      const validation = validateConnection(attempt, nodes, edges);

      if (!validation.valid) {
        console.warn('Invalid connection:', validation.message);
        // TODO: Show toast notification
        return;
      }

      // Add edge
      const newEdges = addEdge(connection, edges);
      setEdges(newEdges);

      // Update workflow
      setTimeout(() => {
        const updatedWorkflow = reactFlowToWorkflow(
          nodes,
          newEdges,
          workflow.id,
          workflow.name
        );
        onWorkflowChange(updatedWorkflow);
      }, 50);
    },
    [readonly, nodes, edges, workflow.id, workflow.name, setEdges, onWorkflowChange]
  );

  /**
   * Handle node click
   */
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const canvasNode = node as CanvasNode;
      setSelectedNode(canvasNode);

      if (onNodeClick) {
        onNodeClick(canvasNode.data.action);
      }
    },
    [onNodeClick]
  );

  /**
   * Handle edge click
   */
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const canvasEdge = edge as CanvasEdge;

      if (onEdgeClick) {
        onEdgeClick(canvasEdge.data.connection);
      }
    },
    [onEdgeClick]
  );

  /**
   * Handle canvas click (deselect)
   */
  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Fit view to show all nodes
   */
  const handleFitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.1, duration: 300 });
    }
  }, [reactFlowInstance]);

  /**
   * Auto-layout nodes
   */
  const handleAutoLayout = useCallback(() => {
    if (readonly) return;

    const layoutedActions = autoLayout(workflow);
    const updatedWorkflow = {
      ...workflow,
      actions: layoutedActions,
    };

    onWorkflowChange(updatedWorkflow);

    // Fit view after layout
    setTimeout(() => {
      handleFitView();
    }, 100);
  }, [readonly, workflow, onWorkflowChange, handleFitView]);

  /**
   * Delete selected elements
   */
  const handleDelete = useCallback(() => {
    if (readonly) return;

    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);

    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;

    // Remove selected nodes and edges
    const newNodes = nodes.filter((n) => !n.selected);
    const newEdges = edges.filter(
      (e) =>
        !e.selected &&
        !selectedNodeIds.includes(e.source) &&
        !selectedNodeIds.includes(e.target)
    );

    setNodes(newNodes);
    setEdges(newEdges);

    // Update workflow
    const updatedWorkflow = reactFlowToWorkflow(
      newNodes,
      newEdges,
      workflow.id,
      workflow.name
    );
    onWorkflowChange(updatedWorkflow);

    setSelectedNode(null);
  }, [readonly, nodes, edges, workflow.id, workflow.name, setNodes, setEdges, onWorkflowChange]);

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  useEffect(() => {
    if (!settings.keyboardShortcuts || readonly) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Delete: Delete selected elements
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        handleDelete();
      }

      // Ctrl/Cmd + A: Select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
      }

      // Ctrl/Cmd + F: Fit view
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        handleFitView();
      }

      // Ctrl/Cmd + L: Auto layout
      if ((event.ctrlKey || event.metaKey) && event.key === 'l') {
        event.preventDefault();
        handleAutoLayout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    settings.keyboardShortcuts,
    readonly,
    handleDelete,
    handleFitView,
    handleAutoLayout,
    setNodes,
  ]);

  // ============================================================================
  // Custom Edge Deletion
  // ============================================================================

  useEffect(() => {
    const handleEdgeDelete = (event: Event) => {
      const customEvent = event as CustomEvent<{ edgeId: string }>;
      const edgeId = customEvent.detail.edgeId;

      if (readonly) return;

      const newEdges = edges.filter((e) => e.id !== edgeId);
      setEdges(newEdges);

      // Update workflow
      const updatedWorkflow = reactFlowToWorkflow(
        nodes,
        newEdges,
        workflow.id,
        workflow.name
      );
      onWorkflowChange(updatedWorkflow);
    };

    window.addEventListener('delete-edge', handleEdgeDelete);
    return () => window.removeEventListener('delete-edge', handleEdgeDelete);
  }, [readonly, nodes, edges, workflow.id, workflow.name, setEdges, onWorkflowChange]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div
      ref={containerRef}
      className={`workflow-canvas ${className}`}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: COLORS.background,
        ...style,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={settings.minZoom}
        maxZoom={settings.maxZoom}
        defaultViewport={{ x: 0, y: 0, zoom: settings.defaultZoom }}
        snapToGrid={settings.snapToGrid}
        snapGrid={[settings.gridSize, settings.gridSize]}
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        nodesFocusable={settings.nodesSelectable}
        edgesFocusable={settings.edgesSelectable}
        elementsSelectable={settings.nodesSelectable || settings.edgesSelectable}
        selectNodesOnDrag={false}
        panOnScroll={settings.panOnScroll}
        zoomOnScroll={!settings.panOnScroll}
        zoomOnDoubleClick={false}
        deleteKeyCode={readonly ? null : ['Backspace', 'Delete']}
      >
        {/* Background grid */}
        {settings.showGrid && (
          <Background
            color={GRID_CONFIG.color}
            gap={GRID_CONFIG.size}
            size={GRID_CONFIG.dotSize}
            variant="dots"
          />
        )}

        {/* Controls */}
        {settings.showControls && (
          <Controls
            showZoom={true}
            showFitView={true}
            showInteractive={false}
            position="top-left"
          />
        )}

        {/* Minimap */}
        {settings.showMinimap && (
          <MiniMap
            nodeColor={(node) => {
              const canvasNode = node as CanvasNode;
              if (canvasNode.style?.borderColor) {
                return canvasNode.style.borderColor as string;
              }
              return COLORS.primary;
            }}
            nodeBorderRadius={4}
            maskColor={COLORS.selectionFill}
            position="bottom-right"
            style={{
              backgroundColor: COLORS.backgroundLight,
              border: `1px solid ${COLORS.border}`,
            }}
          />
        )}

        {/* Top panel - Actions */}
        <Panel position="top-right" className="workflow-canvas-panel">
          <div className="flex gap-2">
            <button
              onClick={handleFitView}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm"
              title="Fit view (Ctrl+F)"
            >
              Fit View
            </button>
            {!readonly && (
              <>
                <button
                  onClick={handleAutoLayout}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm"
                  title="Auto layout (Ctrl+L)"
                >
                  Auto Layout
                </button>
              </>
            )}
          </div>
        </Panel>

        {/* Bottom panel - Info */}
        <Panel position="bottom-left" className="workflow-canvas-panel">
          <div className="text-xs text-gray-400">
            <div>Nodes: {nodes.length}</div>
            <div>Edges: {edges.length}</div>
            {selectedNode && <div>Selected: {selectedNode.data.action.type}</div>}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

// ============================================================================
// Main Component (Outer - with Provider)
// ============================================================================

export interface WorkflowCanvasWrapperProps extends WorkflowCanvasProps {
  /** Skip provider wrapper if already inside ReactFlowProvider */
  skipProvider?: boolean;
}

export function WorkflowCanvas({ skipProvider, ...props }: WorkflowCanvasWrapperProps) {
  // If skipProvider is true, render inner component directly
  if (skipProvider) {
    return <WorkflowCanvasInner {...props} />;
  }

  // Otherwise wrap with provider
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default WorkflowCanvas;
