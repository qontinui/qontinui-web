"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
  type Connection,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StateNode } from "./StateNode";
import { TransitionEdge } from "./TransitionEdge";
import { useGraphLayout } from "./useGraphLayout";
import type {
  UIBridgeState,
  UIBridgeTransition,
  BuilderMode,
  BuilderAction,
} from "@/lib/state-machine-builder/types";
import type { ValidationIssue } from "@/lib/state-machine-builder/validation";
import { Network } from "lucide-react";

interface StateMachineCanvasProps {
  states: UIBridgeState[];
  transitions: UIBridgeTransition[];
  selectedStateId: string | null;
  selectedTransitionId: string | null;
  mode: BuilderMode;
  onSelectState: (id: string | null) => void;
  onSelectTransition: (id: string | null) => void;
  onDeselectAll: () => void;
  dispatch?: React.Dispatch<BuilderAction>;
  validationIssues?: ValidationIssue[];
}

const nodeTypes: NodeTypes = { stateNode: StateNode };
const edgeTypes: EdgeTypes = { transitionEdge: TransitionEdge };

function StateMachineCanvasInner({
  states,
  transitions,
  selectedStateId,
  selectedTransitionId,
  mode,
  onSelectState,
  onSelectTransition,
  onDeselectAll,
  dispatch,
  validationIssues,
}: StateMachineCanvasProps) {
  const statesWithIssues = useMemo(() => {
    if (!validationIssues) return new Set<string>();
    const set = new Set<string>();
    for (const issue of validationIssues) {
      if (issue.stateId) set.add(issue.stateId);
    }
    return set;
  }, [validationIssues]);
  const rawNodes: Node[] = useMemo(
    () =>
      states.map((state) => ({
        id: state.id,
        type: "stateNode",
        position: { x: 0, y: 0 },
        data: {
          state,
          selected: state.id === selectedStateId,
          hasIssue: statesWithIssues.has(state.id),
          mode,
        },
      })),
    [states, selectedStateId, statesWithIssues, mode]
  );

  const rawEdges: Edge[] = useMemo(
    () =>
      transitions.map((transition) => ({
        id: transition.id,
        type: "transitionEdge",
        source: transition.from,
        target: transition.to,
        data: {
          action: transition.action,
          count: transition.count,
        },
        animated: true,
        selected: transition.id === selectedTransitionId,
      })),
    [transitions, selectedTransitionId]
  );

  const { nodes, edges } = useGraphLayout(rawNodes, rawEdges, {
    direction: "TB",
    nodeWidth: 200,
    nodeHeight: 80,
    nodeSep: 50,
    rankSep: 80,
  });

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectState(node.id);
    },
    [onSelectState]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onSelectTransition(edge.id);
    },
    [onSelectTransition]
  );

  const handlePaneClick = useCallback(() => {
    onDeselectAll();
  }, [onDeselectAll]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!dispatch || !connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      dispatch({
        type: "ADD_TRANSITION",
        transition: {
          id: `transition-${Date.now()}`,
          from: connection.source,
          to: connection.target,
          action: { type: "click" },
        },
      });
    },
    [dispatch]
  );

  const isViewMode = mode === "view";
  const isEditMode = mode === "edit";

  if (states.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
        <Network className="w-12 h-12 opacity-40" />
        <p className="text-sm text-center max-w-xs">
          No states yet. Use Discover mode to find states, or add them manually
          in Edit mode.
        </p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onPaneClick={handlePaneClick}
      onConnect={isEditMode ? handleConnect : undefined}
      nodesDraggable={!isViewMode}
      nodesConnectable={isEditMode}
      connectionLineStyle={{
        stroke: "var(--brand-primary)",
        strokeWidth: 2,
        strokeDasharray: "5 5",
      }}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      className="bg-surface-canvas"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1}
        color="var(--brand-secondary)"
        style={{ opacity: 0.15 }}
      />
      <Controls
        showInteractive={!isViewMode}
        className="!bg-surface-raised !border-border-subtle !shadow-md [&>button]:!bg-surface-raised [&>button]:!border-border-subtle [&>button]:!text-text-muted [&>button:hover]:!bg-surface-raised/80"
      />
      <MiniMap
        nodeStrokeWidth={3}
        nodeColor={(node) => {
          const state = (node.data as { state: UIBridgeState }).state;
          if (state?.isGlobal) return "#22c55e";
          if (state?.isModal) return "#a855f7";
          return "var(--brand-secondary)";
        }}
        maskColor="rgba(0, 0, 0, 0.6)"
        className="!bg-surface-raised !border-border-subtle"
      />
    </ReactFlow>
  );
}

export function StateMachineCanvas(props: StateMachineCanvasProps) {
  return (
    <ReactFlowProvider>
      <StateMachineCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
