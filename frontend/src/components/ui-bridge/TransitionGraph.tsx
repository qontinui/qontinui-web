"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  ConnectionMode,
} from "reactflow";
import "reactflow/dist/style.css";

import type {
  SuggestedTransition,
  UIBridgeDiscoveredState,
} from "@/hooks/useUIBridgeExploration";
import { getUniqueStates } from "@/lib/ui-bridge/transition-builder";

interface TransitionGraphProps {
  transitions: SuggestedTransition[];
  discoveredStates?: UIBridgeDiscoveredState[];
  onTransitionSelect?: (transition: SuggestedTransition) => void;
  acceptedIds?: Set<string>;
  rejectedIds?: Set<string>;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return "#22c55e"; // green-500
  if (confidence >= 0.4) return "#eab308"; // yellow-500
  return "#ef4444"; // red-500
}

function getNodeColor(isInitial: boolean, isFinal: boolean): string {
  if (isInitial) return "#3b82f6"; // blue-500
  if (isFinal) return "#a855f7"; // purple-500
  return "#6b7280"; // gray-500
}

export function TransitionGraph({
  transitions,
  discoveredStates,
  onTransitionSelect,
  acceptedIds = new Set(),
  rejectedIds = new Set(),
}: TransitionGraphProps) {
  // Build nodes and edges from transitions
  const { initialNodes, initialEdges } = useMemo(() => {
    const states = getUniqueStates(transitions);
    const stateArray = Array.from(states);

    // Find initial and final states
    const fromStates = new Set(transitions.map((t) => t.fromStateHash));
    const toStates = new Set(transitions.map((t) => t.toStateHash));
    const initialStates = stateArray.filter((s) => !toStates.has(s));
    const finalStates = stateArray.filter((s) => !fromStates.has(s));

    // Create state name lookup from discovered states and transitions
    const stateNames = new Map<string, string>();
    for (const t of transitions) {
      if (t.fromStateName) stateNames.set(t.fromStateHash, t.fromStateName);
      if (t.toStateName) stateNames.set(t.toStateHash, t.toStateName);
    }
    if (discoveredStates) {
      for (const state of discoveredStates) {
        // Try to match by ID or name patterns
        for (const hash of stateArray) {
          if (!stateNames.has(hash)) {
            stateNames.set(hash, state.name);
            break;
          }
        }
      }
    }

    // Calculate node positions using a simple force-directed layout
    const nodeCount = stateArray.length;
    const radius = Math.max(200, nodeCount * 40);
    const centerX = 400;
    const centerY = 300;

    const nodes: Node[] = stateArray.map((stateHash, index) => {
      const angle = (2 * Math.PI * index) / nodeCount - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      const isInitial = initialStates.includes(stateHash);
      const isFinal = finalStates.includes(stateHash);
      const stateName = stateNames.get(stateHash) || `State ${index + 1}`;

      return {
        id: stateHash,
        position: { x, y },
        data: {
          label: (
            <div className="text-center">
              <div className="font-medium text-sm">{stateName}</div>
              <div className="text-xs text-gray-400 font-mono">{stateHash}</div>
            </div>
          ),
        },
        style: {
          background: "#1f2937", // gray-800
          border: `2px solid ${getNodeColor(isInitial, isFinal)}`,
          borderRadius: "8px",
          padding: "10px",
          minWidth: "120px",
        },
      };
    });

    // Create edges from transitions
    const edges: Edge[] = transitions.map((transition, _index) => {
      const isAccepted = acceptedIds.has(transition.id);
      const isRejected = rejectedIds.has(transition.id);

      let strokeColor = getConfidenceColor(transition.confidence);
      let strokeDasharray = undefined;
      let strokeOpacity = 1;

      if (isAccepted) {
        strokeColor = "#22c55e"; // green
      } else if (isRejected) {
        strokeColor = "#ef4444"; // red
        strokeDasharray = "5,5";
        strokeOpacity = 0.5;
      }

      return {
        id: transition.id,
        source: transition.fromStateHash,
        target: transition.toStateHash,
        type: "smoothstep",
        animated: !isRejected,
        style: {
          stroke: strokeColor,
          strokeWidth: 2,
          strokeDasharray,
          opacity: strokeOpacity,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
        label: (
          <div className="bg-gray-800 px-2 py-1 rounded text-xs">
            <span className="text-gray-300">{transition.triggerAction}</span>
            <span className="text-gray-500 ml-1">
              ({(transition.confidence * 100).toFixed(0)}%)
            </span>
          </div>
        ),
        labelBgStyle: { fill: "transparent" },
        labelStyle: { fill: "#fff" },
        data: { transition },
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [transitions, discoveredStates, acceptedIds, rejectedIds]);

  const [nodes, _setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const transition = edge.data?.transition as
        | SuggestedTransition
        | undefined;
      if (transition && onTransitionSelect) {
        onTransitionSelect(transition);
      }
    },
    [onTransitionSelect]
  );

  if (transitions.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-muted-foreground">
        No transitions to display
      </div>
    );
  }

  return (
    <div className="h-[400px] rounded-md border bg-gray-900">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClick}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: "smoothstep",
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={20} />
        <Controls className="bg-gray-800 border-gray-700" />
        <MiniMap
          nodeColor={(node) => {
            const borderColor = (node.style?.border as string) || "";
            if (borderColor.includes("#3b82f6")) return "#3b82f6";
            if (borderColor.includes("#a855f7")) return "#a855f7";
            return "#6b7280";
          }}
          maskColor="rgba(0, 0, 0, 0.5)"
          className="bg-gray-800 border-gray-700"
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-gray-800/90 rounded-lg p-3 space-y-2 text-xs">
        <div className="font-medium text-gray-300 mb-1">Legend</div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2 border-blue-500 bg-gray-800"></div>
          <span className="text-gray-400">Initial State</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2 border-purple-500 bg-gray-800"></div>
          <span className="text-gray-400">Final State</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-green-500"></div>
          <span className="text-gray-400">High Confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-yellow-500"></div>
          <span className="text-gray-400">Medium Confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-red-500"></div>
          <span className="text-gray-400">Low Confidence</span>
        </div>
      </div>
    </div>
  );
}
