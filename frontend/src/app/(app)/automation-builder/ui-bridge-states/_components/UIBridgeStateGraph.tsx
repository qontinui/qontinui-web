"use client";

import { useCallback, useMemo, useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
  MarkerType,
  Panel,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid, Keyboard, Maximize, Play } from "lucide-react";
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
  initialStateId?: string | null;
  onStartElementDrag?: (stateId: string, elementId: string) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
  isDragging?: boolean;
  dropTargetStateId?: string | null;
  onDeleteTransition?: (id: string) => void;
}

function UIBridgeStateGraphInner({
  states,
  transitions,
  selectedStateId,
  selectedTransitionId: _selectedTransitionId,
  onSelectState,
  onSelectTransition,
  highlightedPath,
  initialStateId,
  onStartElementDrag,
  onDragOver,
  onDrop,
  isDragging,
  dropTargetStateId,
  onDeleteTransition,
}: UIBridgeStateGraphProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const reactFlowInstance = useReactFlow();
  const prevStateCountRef = useRef(states.length);

  const highlightedTransitionIds = useMemo(
    () => new Set(highlightedPath?.map((s) => s.transition_id) ?? []),
    [highlightedPath]
  );

  // Determine initial state (first state if none marked)
  const effectiveInitialStateId = useMemo(() => {
    if (initialStateId) return initialStateId;
    const markedInitial = states.find(
      (s) => s.extra_metadata?.initial === true
    );
    if (markedInitial) return markedInitial.state_id;
    return states[0]?.state_id ?? null;
  }, [states, initialStateId]);

  // Compute transition counts per state
  const transitionCounts = useMemo(() => {
    const outgoing = new Map<string, number>();
    const incoming = new Map<string, number>();
    for (const t of transitions) {
      for (const from of t.from_states) {
        outgoing.set(from, (outgoing.get(from) ?? 0) + 1);
      }
      for (const to of t.activate_states) {
        incoming.set(to, (incoming.get(to) ?? 0) + 1);
      }
    }
    return { outgoing, incoming };
  }, [transitions]);

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
          isInitial: state.state_id === effectiveInitialStateId,
          outgoingCount: transitionCounts.outgoing.get(state.state_id) ?? 0,
          incomingCount: transitionCounts.incoming.get(state.state_id) ?? 0,
          isDropTarget: isDragging && dropTargetStateId === state.state_id,
          onStartElementDrag,
        } satisfies StateNodeData,
      })),
    [states, selectedStateId, effectiveInitialStateId, onStartElementDrag, transitionCounts, isDragging, dropTargetStateId]
  );

  // Build edges from transitions
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    for (const trans of transitions) {
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
              actionTypes: trans.actions.map((a) => a.type),
              isHighlighted: highlightedTransitionIds.has(trans.transition_id),
              staysVisible: trans.stays_visible,
              firstActionTarget: trans.actions[0]?.target ?? trans.actions[0]?.url ?? undefined,
            } satisfies TransitionEdgeData,
          });
        }
      }
    }
    return edges;
  }, [transitions, highlightedTransitionIds]);

  // Apply layout
  const layouted = useMemo(() => {
    if (initialNodes.length === 0) return { nodes: [], edges: [] };
    return getLayoutedElements(initialNodes, initialEdges, {
      direction: "TB",
      nodeWidth: 260,
      nodeHeight: 120,
      nodeSep: 70,
      rankSep: 130,
    });
  }, [initialNodes, initialEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges);

  useEffect(() => {
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [layouted, setNodes, setEdges]);

  // Auto-fit view when states are added
  useEffect(() => {
    if (states.length > prevStateCountRef.current) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
      }, 100);
    }
    prevStateCountRef.current = states.length;
  }, [states.length, reactFlowInstance]);

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

  // Re-layout
  const handleRelayout = useCallback(() => {
    const result = getLayoutedElements(nodes, edges, {
      direction: "TB",
      nodeWidth: 260,
      nodeHeight: 120,
      nodeSep: 70,
      rankSep: 130,
    });
    setNodes(result.nodes);
    setEdges(result.edges);
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
    }, 50);
  }, [nodes, edges, setNodes, setEdges, reactFlowInstance]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        return;
      }

      // Escape to deselect
      if (e.key === "Escape") {
        onSelectState(null);
        onSelectTransition(null);
        setShowShortcuts(false);
      }
      // ? to toggle shortcuts help
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts((prev) => !prev);
      }
      // F to fit view
      if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
      }
      // L for re-layout
      if (e.key === "l" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        handleRelayout();
      }
      // + / - for zoom
      if (e.key === "=" || e.key === "+") {
        reactFlowInstance.zoomIn({ duration: 200 });
      }
      if (e.key === "-") {
        reactFlowInstance.zoomOut({ duration: 200 });
      }
      // I to jump to initial state
      if (e.key === "i" && !e.ctrlKey && !e.metaKey && !e.altKey && effectiveInitialStateId) {
        onSelectState(effectiveInitialStateId);
        onSelectTransition(null);
        const node = reactFlowInstance.getNode(effectiveInitialStateId);
        if (node) {
          reactFlowInstance.setCenter(
            node.position.x + 130,
            node.position.y + 60,
            { duration: 300, zoom: reactFlowInstance.getZoom() }
          );
        }
      }
      // Delete/Backspace to delete selected transition
      if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey) {
        const selectedEdge = edges.find((edge) => edge.selected);
        if (selectedEdge && onDeleteTransition) {
          const edgeData = selectedEdge.data as unknown as TransitionEdgeData;
          if (edgeData?.transitionId) {
            // Find the full transition to get its DB id
            const trans = transitions.find((t) => t.transition_id === edgeData.transitionId);
            if (trans) {
              e.preventDefault();
              onDeleteTransition(trans.id);
            }
          }
        }
      }
      // Tab to cycle through states
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && states.length > 0) {
        e.preventDefault();
        const currentIndex = states.findIndex(
          (s) => s.state_id === (nodes.find((n) => n.selected)?.id)
        );
        const nextIndex = e.shiftKey
          ? (currentIndex <= 0 ? states.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % states.length;
        const nextState = states[nextIndex];
        if (nextState) {
          onSelectState(nextState.state_id);
          onSelectTransition(null);
          // Center on the selected node
          const node = reactFlowInstance.getNode(nextState.state_id);
          if (node) {
            reactFlowInstance.setCenter(
              node.position.x + 130,
              node.position.y + 60,
              { duration: 300, zoom: reactFlowInstance.getZoom() }
            );
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSelectState, onSelectTransition, reactFlowInstance, handleRelayout, states, nodes, edges, transitions, effectiveInitialStateId, onDeleteTransition]);

  // Graph stats for the info panel
  const graphStats = useMemo(() => ({
    states: states.length,
    transitions: transitions.length,
    initialState: states.find((s) => s.state_id === effectiveInitialStateId)?.name ?? "None",
  }), [states, transitions, effectiveInitialStateId]);

  if (states.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p>No states discovered yet. Use the Discovery tab to discover states.</p>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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
        minZoom={0.05}
        maxZoom={3}
        deleteKeyCode={null}
        selectNodesOnDrag={false}
      >
        <Background gap={20} size={1} variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as unknown as StateNodeData;
            if (data?.isInitial) return "#FFD700";
            return data?.isBlocking ? "#f59e0b" : "var(--brand-primary)";
          }}
          maskColor="rgba(0,0,0,0.15)"
          pannable
          zoomable
        />

        {/* Top right controls */}
        <Panel position="top-right">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reactFlowInstance.fitView({ padding: 0.2, duration: 300 })}
              className="h-7 w-7 p-0"
              title="Fit to view (F)"
            >
              <Maximize className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowShortcuts((prev) => !prev)}
              className="h-7 w-7 p-0"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="size-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleRelayout} title="Re-layout (L)">
              <LayoutGrid className="size-3.5 mr-1.5" />
              Re-layout
            </Button>
          </div>
        </Panel>

        {/* Bottom left stats */}
        <Panel position="bottom-left">
          <div className="text-[10px] text-text-muted/70 bg-surface-primary/80 backdrop-blur-sm px-2.5 py-1.5 rounded border border-border-primary/50 flex items-center gap-2">
            <span>{graphStats.states} states</span>
            <span className="text-text-muted/30">|</span>
            <span>{graphStats.transitions} transitions</span>
            {graphStats.initialState !== "None" && (
              <>
                <span className="text-text-muted/30">|</span>
                <span className="text-yellow-500">
                  <Play className="size-2 inline mr-0.5 fill-current" />
                  {graphStats.initialState}
                </span>
              </>
            )}
          </div>
        </Panel>

        {/* Keyboard shortcuts overlay */}
        {showShortcuts && (
          <Panel position="bottom-right">
            <div className="bg-surface-primary/95 border border-border-primary rounded-lg p-4 text-xs shadow-lg backdrop-blur-sm min-w-[200px]">
              <h4 className="font-semibold text-text-primary mb-2.5">Keyboard Shortcuts</h4>
              <div className="space-y-1.5 text-text-muted">
                <div className="flex items-center justify-between gap-4">
                  <span>Deselect all</span>
                  <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">Esc</kbd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Toggle shortcuts</span>
                  <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">?</kbd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Fit to view</span>
                  <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">F</kbd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Re-layout</span>
                  <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">L</kbd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Zoom in/out</span>
                  <span>
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">+</kbd>
                    {" "}
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">-</kbd>
                  </span>
                </div>
                <div className="border-t border-border-primary pt-1.5 mt-1.5">
                  <div className="flex items-center justify-between gap-4">
                    <span>Cycle states</span>
                    <span>
                      <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">Tab</kbd>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Jump to initial</span>
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">I</kbd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Create transition</span>
                    <span className="text-[10px]">Drag element</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Move element</span>
                    <span className="text-[10px]">Alt+Drag</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Delete transition</span>
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-[10px] font-mono">Del</kbd>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export function UIBridgeStateGraph(props: UIBridgeStateGraphProps) {
  return (
    <ReactFlowProvider>
      <UIBridgeStateGraphInner {...props} />
    </ReactFlowProvider>
  );
}
