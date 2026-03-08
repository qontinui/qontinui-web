/**
 * Workflow Canvas - Main React Flow canvas component
 *
 * Provides a visual graph editor for workflows with drag-and-drop,
 * connections, validation, and keyboard shortcuts.
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
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
  OnReconnect,
  NodeChange,
  EdgeChange,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";

import { Workflow, Action } from "@/lib/action-schema/action-types";
import {
  CanvasNode,
  CanvasEdge,
  CanvasSettings,
  DEFAULT_CANVAS_SETTINGS,
  ConnectionAttempt,
  EdgeInfo,
} from "./canvas-types";
import {
  workflowToReactFlow,
  reactFlowToWorkflow,
  validateConnection,
  autoLayout,
} from "./canvas-utils";
import { CustomEdge } from "./CustomEdge";
import { DefaultNode } from "./nodes/DefaultNode";
import {
  GRID_CONFIG,
  COLORS,
  getConnectionColor,
  getConnectionStyle,
} from "./canvas-config";
import { ControlFlowNodes } from "./nodes/ControlFlowNodes";
import { CodeBlockNode, CustomFunctionNode } from "./nodes/CodeNodes";
import "./WorkflowCanvas.css";

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
  onEdgeClick?: (edgeInfo: EdgeInfo) => void;

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
  // Default for most nodes - categories use DefaultNode
  default: DefaultNode,
  find: DefaultNode,
  mouse: DefaultNode,
  keyboard: DefaultNode,
  control_flow: DefaultNode,
  data: DefaultNode,
  state: DefaultNode,

  // Specific control flow nodes with custom handle IDs
  IF: ControlFlowNodes.IF,
  LOOP: ControlFlowNodes.LOOP,
  SWITCH: ControlFlowNodes.SWITCH,
  TRY_CATCH: ControlFlowNodes.TRY_CATCH,
  BREAK: ControlFlowNodes.BREAK,
  CONTINUE: ControlFlowNodes.CONTINUE,

  // Code execution nodes
  CODE_BLOCK: CodeBlockNode,
  CUSTOM_FUNCTION: CustomFunctionNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

// ============================================================================
// Main Component (Inner - with React Flow context)
// ============================================================================

const DEFAULT_CANVAS_STYLE: React.CSSProperties = {};

function WorkflowCanvasInner({
  workflow,
  onWorkflowChange,
  readonly = false,
  onNodeClick,
  onEdgeClick,
  settings: userSettings,
  className = "",
  style = DEFAULT_CANVAS_STYLE,
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialNodes as unknown as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialEdges as unknown as Edge[]
  );
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);

  // Track if we initiated the last workflow change
  const isInternalChangeRef = useRef(false);
  const lastWorkflowRef = useRef(workflow);

  // Create a stable key for the workflow to detect actual content changes
  // This prevents infinite loops from object reference changes
  const workflowKey = useMemo(() => {
    const actionIds = workflow.actions
      .map((a) => a.id)
      .sort()
      .join(",");
    const connectionKeys = Object.entries(workflow.connections || {})
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join(";");
    return `${workflow.id}|${actionIds}|${connectionKeys}`;
  }, [workflow.id, workflow.actions, workflow.connections]);

  // Update nodes/edges when workflow changes externally
  useEffect(() => {
    // Skip if we initiated this change
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      lastWorkflowRef.current = workflow;
      return;
    }

    const { nodes: newNodes, edges: newEdges } = workflowToReactFlow(workflow);

    setNodes(newNodes as unknown as Node[]);
    setEdges(newEdges as unknown as Edge[]);
    lastWorkflowRef.current = workflow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey]); // Use stable key instead of object references

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle node changes (position, selection, etc.)
   */
  const handleNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readonly) return;

      // Apply changes first
      onNodesChange(changes);

      // Update workflow if positions changed or nodes removed
      const positionChanges = changes.filter((c) => c.type === "position");
      const removals = changes.filter((c) => c.type === "remove");

      if (positionChanges.length > 0 || removals.length > 0) {
        // IMPORTANT: Mark as internal change IMMEDIATELY to prevent race conditions
        // where external updates could overwrite our pending changes
        isInternalChangeRef.current = true;

        // Use queueMicrotask to avoid setState during render
        setTimeout(() => {
          setNodes((currentNodes) => {
            setEdges((currentEdges) => {
              // Queue the workflow update outside of render
              queueMicrotask(() => {
                const updatedWorkflow = reactFlowToWorkflow(
                  currentNodes as unknown as CanvasNode[],
                  currentEdges as unknown as CanvasEdge[],
                  workflow.id,
                  workflow.name
                );
                // Re-set the flag before calling onWorkflowChange to ensure
                // the subsequent useEffect sees it as an internal change
                isInternalChangeRef.current = true;
                onWorkflowChange(updatedWorkflow);
              });
              return currentEdges; // Return unchanged
            });
            return currentNodes; // Return unchanged
          });
        }, 100);
      }
    },
    [
      readonly,
      onNodesChange,
      setNodes,
      setEdges,
      workflow.id,
      workflow.name,
      onWorkflowChange,
    ]
  );

  /**
   * Handle edge changes (selection, deletion, etc.)
   */
  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readonly) return;

      // Apply changes first
      onEdgesChange(changes);

      // Update workflow if edges were removed
      const removals = changes.filter((c) => c.type === "remove");
      if (removals.length > 0) {
        // IMPORTANT: Mark as internal change IMMEDIATELY to prevent race conditions
        isInternalChangeRef.current = true;

        // Use queueMicrotask to avoid setState during render
        setTimeout(() => {
          setNodes((currentNodes) => {
            setEdges((currentEdges) => {
              // Queue the workflow update outside of render
              queueMicrotask(() => {
                const updatedWorkflow = reactFlowToWorkflow(
                  currentNodes as unknown as CanvasNode[],
                  currentEdges as unknown as CanvasEdge[],
                  workflow.id,
                  workflow.name
                );
                isInternalChangeRef.current = true;
                onWorkflowChange(updatedWorkflow);
              });
              return currentEdges; // Return unchanged
            });
            return currentNodes; // Return unchanged
          });
        }, 50);
      }
    },
    [
      readonly,
      onEdgesChange,
      setNodes,
      setEdges,
      workflow.id,
      workflow.name,
      onWorkflowChange,
    ]
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

      const validation = validateConnection(
        attempt,
        nodes as unknown as CanvasNode[],
        edges as unknown as CanvasEdge[]
      );

      if (!validation.valid) {
        console.warn("Invalid connection:", validation.message);
        toast.error("Invalid Connection", {
          description: validation.message,
        });
        return;
      }

      // Parse sourceHandle to get connection type and output index
      let connType: "main" | "error" | "success" | "parallel" = "main";
      let outputIndex = 0;

      if (connection.sourceHandle) {
        const parts = connection.sourceHandle.split("-");
        if (parts.length >= 2) {
          const handleType = parts[0];
          const handleIndex = parseInt(parts[1] || "0", 10);

          if (
            handleType === "error" ||
            handleType === "success" ||
            handleType === "parallel"
          ) {
            connType = handleType;
          } else {
            connType = "main";
          }

          outputIndex = isNaN(handleIndex) ? 0 : handleIndex;
        }
      }

      // Get source action for label generation
      const sourceNode = nodes.find((n) => n.id === connection.source) as
        | CanvasNode
        | undefined;
      const sourceAction = sourceNode?.data.action;

      // Generate edge label
      let label: string | undefined;
      if (sourceAction) {
        switch (sourceAction.type) {
          case "IF":
            label = outputIndex === 0 ? "true" : "false";
            break;
          case "TRY_CATCH":
            label = connType === "error" ? "catch" : "try";
            break;
          case "LOOP":
            label = outputIndex === 0 ? "loop" : "exit";
            break;
          case "SWITCH": {
            const switchConfig = sourceAction.config as {
              cases?: Array<{ value?: unknown }>;
            };
            if (
              switchConfig?.cases &&
              Array.isArray(switchConfig.cases) &&
              outputIndex < switchConfig.cases.length
            ) {
              const caseItem = switchConfig.cases[outputIndex];
              label = String(caseItem?.value || caseItem);
            } else {
              label = "default";
            }
            break;
          }
        }
      }

      // Get color and style
      const color = getConnectionColor(connType);
      const style = getConnectionStyle(connType);

      // Create enriched edge with full data
      const enrichedEdge: CanvasEdge = {
        id: `${connection.source}-${connection.target}-${Date.now()}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: "custom",
        animated: false,
        data: {
          connection: {
            action: connection.target!,
            type: connType,
            index: 0,
          },
          connectionType: connType,
          outputIndex,
          label,
          selected: false,
          animated: false,
        },
        style: {
          ...style,
          stroke: color,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color,
          width: 20,
          height: 20,
        },
      };

      // Add enriched edge
      const newEdges = [...edges, enrichedEdge];
      setEdges(newEdges as unknown as Edge[]);

      // IMPORTANT: Mark as internal change IMMEDIATELY to prevent race conditions
      isInternalChangeRef.current = true;

      // Update workflow
      setTimeout(() => {
        const updatedWorkflow = reactFlowToWorkflow(
          nodes as unknown as CanvasNode[],
          newEdges as unknown as CanvasEdge[],
          workflow.id,
          workflow.name
        );
        isInternalChangeRef.current = true;
        onWorkflowChange(updatedWorkflow);
      }, 50);
    },
    [
      readonly,
      nodes,
      edges,
      workflow.id,
      workflow.name,
      setEdges,
      onWorkflowChange,
    ]
  );

  /**
   * Handle edge reconnection (dragging edge endpoint to different node)
   */
  const handleReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: ReactFlowConnection) => {
      if (readonly) return;

      // Validate new connection
      const attempt: ConnectionAttempt = {
        source: newConnection.source!,
        sourceHandle: newConnection.sourceHandle,
        target: newConnection.target!,
        targetHandle: newConnection.targetHandle,
      };

      const validation = validateConnection(
        attempt,
        nodes as unknown as CanvasNode[],
        edges as unknown as CanvasEdge[]
      );

      if (!validation.valid) {
        console.warn("Invalid reconnection:", validation.message);
        toast.error("Invalid Reconnection", {
          description: validation.message,
        });
        return;
      }

      // Remove old edge and add new one
      const edgesWithoutOld = edges.filter((e) => e.id !== oldEdge.id);
      const newEdges = addEdge(newConnection, edgesWithoutOld);
      setEdges(newEdges);

      // IMPORTANT: Mark as internal change IMMEDIATELY to prevent race conditions
      isInternalChangeRef.current = true;

      // Update workflow
      setTimeout(() => {
        const updatedWorkflow = reactFlowToWorkflow(
          nodes as unknown as CanvasNode[],
          newEdges as unknown as CanvasEdge[],
          workflow.id,
          workflow.name
        );
        isInternalChangeRef.current = true;
        onWorkflowChange(updatedWorkflow);
      }, 50);
    },
    [
      readonly,
      nodes,
      edges,
      workflow.id,
      workflow.name,
      setEdges,
      onWorkflowChange,
    ]
  );

  /**
   * Handle node click
   */
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const canvasNode = node as unknown as CanvasNode;
      setSelectedNode(canvasNode);

      if (onNodeClick) {
        onNodeClick(canvasNode.data.action);
      }
    },
    [onNodeClick]
  );

  /**
   * Handle edge click - builds rich EdgeInfo for editing
   */
  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const canvasEdge = edge as unknown as CanvasEdge;

      if (onEdgeClick) {
        // Parse edge ID to get connection index
        // Format: ${sourceActionId}-${connType}-${outputIndex}-${targetId}-${connIndex}
        const edgeIdParts = canvasEdge.id.split("-");
        const connectionIndex = parseInt(
          edgeIdParts[edgeIdParts.length - 1] || "0",
          10
        );

        // Get source and target action names
        const sourceAction = workflow.actions.find(
          (a) => a.id === canvasEdge.source
        );
        const targetAction = workflow.actions.find(
          (a) => a.id === canvasEdge.target
        );

        const edgeInfo: EdgeInfo = {
          sourceId: canvasEdge.source,
          sourceName: sourceAction?.name || sourceAction?.type || "Unknown",
          targetId: canvasEdge.target,
          targetName: targetAction?.name || targetAction?.type || "Unknown",
          connection: canvasEdge.data.connection,
          outputType: canvasEdge.data.connectionType,
          outputIndex: canvasEdge.data.outputIndex,
          connectionIndex,
        };

        onEdgeClick(edgeInfo);
      }
    },
    [onEdgeClick, workflow.actions]
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

    isInternalChangeRef.current = true;
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
      newNodes as unknown as CanvasNode[],
      newEdges as unknown as CanvasEdge[],
      workflow.id,
      workflow.name
    );
    isInternalChangeRef.current = true;
    onWorkflowChange(updatedWorkflow);

    setSelectedNode(null);
  }, [
    readonly,
    nodes,
    edges,
    workflow.id,
    workflow.name,
    setNodes,
    setEdges,
    onWorkflowChange,
  ]);

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  useEffect(() => {
    if (!settings.keyboardShortcuts || readonly) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Delete: Delete selected elements
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDelete();
      }

      // Ctrl/Cmd + A: Select all
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        event.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
      }

      // Ctrl/Cmd + F: Fit view
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        handleFitView();
      }

      // Ctrl/Cmd + L: Auto layout
      if ((event.ctrlKey || event.metaKey) && event.key === "l") {
        event.preventDefault();
        handleAutoLayout();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
        nodes as unknown as CanvasNode[],
        newEdges as unknown as CanvasEdge[],
        workflow.id,
        workflow.name
      );
      isInternalChangeRef.current = true;
      onWorkflowChange(updatedWorkflow);
    };

    window.addEventListener("delete-edge", handleEdgeDelete);
    return () => window.removeEventListener("delete-edge", handleEdgeDelete);
  }, [
    readonly,
    nodes,
    edges,
    workflow.id,
    workflow.name,
    setEdges,
    onWorkflowChange,
  ]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div
      ref={containerRef}
      className={`workflow-canvas ${className}`}
      data-tutorial-id="workflow-canvas"
      style={{
        width: "100%",
        height: "100%",
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
        onReconnect={handleReconnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes as unknown as typeof nodeTypes}
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
        reconnectRadius={20}
        nodesFocusable={settings.nodesSelectable}
        edgesFocusable={settings.edgesSelectable}
        elementsSelectable={
          settings.nodesSelectable || settings.edgesSelectable
        }
        selectNodesOnDrag={false}
        panOnScroll={settings.panOnScroll}
        zoomOnScroll={!settings.panOnScroll}
        zoomOnDoubleClick={false}
        deleteKeyCode={readonly ? null : ["Backspace", "Delete"]}
      >
        {/* Background grid */}
        {settings.showGrid && (
          <Background
            color={GRID_CONFIG.color}
            gap={GRID_CONFIG.size}
            size={GRID_CONFIG.dotSize}
          />
        )}

        {/* Controls */}
        {settings.showControls && (
          <Controls
            showZoom={true}
            showFitView={true}
            showInteractive={false}
            position="top-left"
            data-tutorial-id="canvas-controls"
          />
        )}

        {/* Minimap */}
        {settings.showMinimap && (
          <MiniMap
            nodeColor={(node) => {
              const canvasNode = node as unknown as CanvasNode;
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
        <Panel
          position="top-right"
          className="workflow-canvas-panel"
          data-tutorial-id="canvas-toolbar"
        >
          <div className="flex gap-2">
            <button
              onClick={handleFitView}
              className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 text-white rounded text-sm"
              title="Fit view (Ctrl+F)"
              data-tutorial-id="fit-view"
            >
              Fit View
            </button>
            {!readonly && (
              <>
                <button
                  onClick={handleAutoLayout}
                  className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 text-white rounded text-sm"
                  title="Auto layout (Ctrl+L)"
                  data-tutorial-id="auto-layout"
                >
                  Auto Layout
                </button>
              </>
            )}
          </div>
        </Panel>

        {/* Bottom panel - Info */}
        <Panel position="bottom-left" className="workflow-canvas-panel">
          <div className="text-xs text-text-muted">
            <div>Nodes: {nodes.length}</div>
            <div>Edges: {edges.length}</div>
            {selectedNode && (
              <div>Selected: {selectedNode.data.action.type}</div>
            )}
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

export function WorkflowCanvas({
  skipProvider,
  ...props
}: WorkflowCanvasWrapperProps) {
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
