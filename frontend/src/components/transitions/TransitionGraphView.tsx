"use client";

import React from "react";
import { Transition, State } from "@/contexts/automation-context/types";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { COLORS } from "./types";

interface TransitionGraphViewProps {
  transitions: Transition[];
  states: State[];
  onTransitionClick: (transition: Transition) => void;
}

export function TransitionGraphView({
  transitions,
  states,
  onTransitionClick: _onTransitionClick,
}: TransitionGraphViewProps) {
  const [nodes, setNodes] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  React.useEffect(() => {
    // Create nodes from states
    const newNodes: Node[] = states.map((state, index) => ({
      id: state.id,
      type: "default",
      position: {
        x: (index % 5) * 200,
        y: Math.floor(index / 5) * 150,
      },
      data: {
        label: state.name,
      },
      style: {
        background: state.initial ? COLORS.primary : "#27272A",
        border: `2px solid ${state.initial ? COLORS.primary : "#666"}`,
        color: "white",
        borderRadius: "8px",
        padding: "10px",
      },
    }));

    // Create edges from transitions
    const newEdges: Edge[] = [];
    transitions.forEach((transition) => {
      if (transition.type === "OutgoingTransition") {
        transition.activateStates.forEach((toStateId) => {
          newEdges.push({
            id: `${transition.fromState}-${toStateId}-${transition.id}`,
            source: transition.fromState,
            target: toStateId,
            type: "smoothstep",
            animated: transition.workflows.length > 0,
            style: {
              stroke:
                transition.workflows.length > 0 ? COLORS.primary : COLORS.gray,
              strokeWidth: 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color:
                transition.workflows.length > 0 ? COLORS.primary : COLORS.gray,
            },
            data: { transition },
          });
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [transitions, states, setNodes, setEdges]);

  return (
    <div className="h-full w-full bg-[#1A1A1B] rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="#333" gap={16} />
        <Controls className="bg-[#27272A] border-gray-700" />
        <MiniMap
          className="bg-[#27272A] border border-gray-700"
          nodeColor={(node) => {
            const state = states.find((s) => s.id === node.id);
            return state?.initial ? COLORS.primary : "#666";
          }}
        />
      </ReactFlow>
    </div>
  );
}
