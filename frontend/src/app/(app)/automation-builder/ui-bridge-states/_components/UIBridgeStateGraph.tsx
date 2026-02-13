"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLayoutedElements } from "@/lib/layout-utils";
import { UIBridgeStateNode } from "./UIBridgeStateNode";
import { UIBridgeTransitionEdge } from "./UIBridgeTransitionEdge";
import type {
  SavedStateWithDetails,
  UIBridgeTransition,
  StateNodeData,
  TransitionEdgeData,
  PathfindingStep,
} from "../_types";

const nodeTypes = { stateNode: UIBridgeStateNode };
const edgeTypes = { transitionEdge: UIBridgeTransitionEdge };

interface UIBridgeStateGraphProps {
  states: SavedStateWithDetails[];
  transitions: UIBridgeTransition[];
  selectedStateId: string | null;
  selectedTransitionId: string | null;
  onSelectState: (stateId: string | null) => void;
  onSelectTransition: (transitionId: string | null) => void;
  highlightedPath?: PathfindingStep[];
}

export function UIBridgeStateGraph({
  states,
  transitions,
  selectedStateId,
  selectedTransitionId: _selectedTransitionId,
  onSelectState,
  onSelectTransition,
  highlightedPath,
}: UIBridgeStateGraphProps) {
  const highlightedTransitionIds = useMemo(
    () => new Set(highlightedPath?.map((s) => s.transition_id) ?? []),
    [highlightedPath]
  );

  // Build nodes from states
  const initialNodes: Node[] = useMemo(
    () =>
      states.map((state) => ({
        id: state.state_id,
        type: "stateNode",
        position: { x: 0, y: 0 },
        data: {
          stateId: state.state_id,
          name: state.name,
          elementCount: state.element_ids.length,
          confidence: state.confidence,
          elementIds: state.element_ids,
          description: state.description,
          isBlocking: state.extra_metadata?.blocking === true,
          isSelected: state.state_id === selectedStateId,
        } satisfies StateNodeData,
      })),
    [states, selectedStateId]
  );

  // Build edges from transitions
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    for (const trans of transitions) {
      // Create an edge from each from_state to each activate_state
      for (const fromState of trans.from_states) {
        for (const toState of trans.activate_states) {
          edges.push({
            id: `${trans.transition_id}-${fromState}-${toState}`,
            source: fromState,
            target: toState,
            type: "transitionEdge",
            markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
            data: {
              transitionId: trans.transition_id,
              name: trans.name,
              pathCost: trans.path_cost,
              actionCount: trans.actions.length,
              isHighlighted: highlightedTransitionIds.has(trans.transition_id),
            } satisfies TransitionEdgeData,
          });
        }
      }
    }
    return edges;
  }, [transitions, highlightedTransitionIds]);

  // Apply layout
  const [, setLayoutApplied] = useState(false);
  const layouted = useMemo(() => {
    if (initialNodes.length === 0) return { nodes: [], edges: [] };
    return getLayoutedElements(initialNodes, initialEdges, {
      direction: "TB",
      nodeWidth: 220,
      nodeHeight: 80,
      nodeSep: 60,
      rankSep: 120,
    });
  }, [initialNodes, initialEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges);

  // Update nodes/edges when data changes
  useEffect(() => {
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    setLayoutApplied(true);
  }, [layouted, setNodes, setEdges]);

  // Handle selection
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const firstNode = selectedNodes[0];
      const firstEdge = selectedEdges[0];
      if (firstNode) {
        const nodeData = firstNode.data as unknown as StateNodeData;
        onSelectState(nodeData.stateId);
        onSelectTransition(null);
      } else if (firstEdge) {
        const edgeData = firstEdge.data as unknown as TransitionEdgeData;
        onSelectTransition(edgeData?.transitionId ?? null);
        onSelectState(null);
      } else {
        onSelectState(null);
        onSelectTransition(null);
      }
    },
    [onSelectState, onSelectTransition]
  );

  // Re-layout button
  const handleRelayout = useCallback(() => {
    const result = getLayoutedElements(nodes, edges, {
      direction: "TB",
      nodeWidth: 220,
      nodeHeight: 80,
      nodeSep: 60,
      rankSep: 120,
    });
    setNodes(result.nodes);
    setEdges(result.edges);
  }, [nodes, edges, setNodes, setEdges]);

  if (states.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p>No states discovered yet. Use the Discovery tab to discover states.</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as unknown as StateNodeData;
            return data?.isBlocking ? "#f59e0b" : "var(--brand-primary)";
          }}
          maskColor="rgba(0,0,0,0.1)"
        />
        <Panel position="top-right">
          <Button variant="outline" size="sm" onClick={handleRelayout}>
            <LayoutGrid className="size-3.5 mr-1.5" />
            Re-layout
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
