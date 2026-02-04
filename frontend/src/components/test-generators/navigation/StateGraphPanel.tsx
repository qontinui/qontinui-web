/**
 * StateGraphPanel
 *
 * Displays the state graph (simplified ReactFlow) alongside a state detail sidebar.
 * For the Navigation Test Generator Tier 2 page.
 */

import { useState, useMemo, useCallback } from "react";
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import { StateDetailSidebar } from "./StateDetailSidebar";
import type { NonVisualState, NonVisualTransition } from "../types";

interface StateGraphPanelProps {
  states: NonVisualState[];
  transitions: NonVisualTransition[];
  onUpdateState?: (state: NonVisualState) => void;
}

function buildNodes(states: NonVisualState[]): Node[] {
  const cols = Math.ceil(Math.sqrt(states.length));
  return states.map((state, i) => ({
    id: state.id,
    position: {
      x: (i % cols) * 250 + 50,
      y: Math.floor(i / cols) * 150 + 50,
    },
    data: {
      label: (
        <div className="text-center">
          <div className="text-xs font-semibold">{state.name}</div>
          <div className="text-[10px] text-neutral-400 mt-0.5">
            {state.elementIds.length} elements
          </div>
          {state.pageUrl && (
            <div className="text-[10px] text-blue-400 mt-0.5 truncate max-w-[150px]">
              {state.pageUrl}
            </div>
          )}
        </div>
      ),
    },
    style: {
      background: "#1e293b",
      border: "1px solid #334155",
      borderRadius: "8px",
      padding: "8px 12px",
      color: "#e2e8f0",
      fontSize: "12px",
      minWidth: "120px",
    },
  }));
}

function buildEdges(transitions: NonVisualTransition[]): Edge[] {
  return transitions.map((t) => ({
    id: t.id,
    source: t.fromStateId,
    target: t.toStateId,
    label: t.triggerLabel || t.triggerAction,
    labelStyle: { fill: "#94a3b8", fontSize: 10 },
    style: {
      stroke: t.confidence > 0.7 ? "#10b981" : t.confidence > 0.4 ? "#f59e0b" : "#ef4444",
      strokeWidth: 2,
    },
    animated: true,
    type: "smoothstep",
  }));
}

export function StateGraphPanel({ states, transitions, onUpdateState }: StateGraphPanelProps) {
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);

  const initialNodes = useMemo(() => buildNodes(states), [states]);
  const initialEdges = useMemo(() => buildEdges(transitions), [transitions]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const selectedState = useMemo(
    () => states.find((s) => s.id === selectedStateId) || null,
    [states, selectedStateId],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedStateId(node.id);
  }, []);

  return (
    <div className="flex h-full">
      {/* Graph */}
      <div className="flex-1 min-w-0">
        {states.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            No states discovered yet. Start an exploration to discover states.
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#334155" gap={20} />
            <Controls />
            <MiniMap
              nodeColor="#1e293b"
              maskColor="rgba(0, 0, 0, 0.7)"
              style={{ background: "#0f172a" }}
            />
          </ReactFlow>
        )}
      </div>

      {/* Detail sidebar */}
      <div className="w-72 flex-shrink-0">
        <StateDetailSidebar
          state={selectedState}
          transitions={transitions}
          allStates={states}
          onUpdateState={onUpdateState}
        />
      </div>
    </div>
  );
}
