"use client";

import { useState, useEffect } from "react";
import {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import { recordingService } from "@/services/service-factory";
import { toast } from "sonner";
import {
  getConfidenceColor,
  getConfidenceLevel,
  type DiscoveredState,
  type DiscoveredStateStructure,
  type DiscoveredTransition,
} from "@/types/recording";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import React from "react";

function getConfidenceBorderColor(
  isApproved: boolean,
  confidenceLevel: string
): string {
  if (isApproved) return "#10b981";
  if (confidenceLevel === "high") return "#3b82f6";
  if (confidenceLevel === "medium") return "#f59e0b";
  return "#ef4444";
}

function createFlowNodes(
  states: DiscoveredState[],
  selectedStateIds: Set<string>
): Node[] {
  return states.map((state, index) => {
    const confidenceLevel = getConfidenceLevel(state.confidence);
    const isApproved = state.user_approved;
    const borderColor = getConfidenceBorderColor(isApproved, confidenceLevel);

    return {
      id: state.id,
      type: "default",
      position:
        state.position_x && state.position_y
          ? { x: state.position_x, y: state.position_y }
          : { x: (index % 5) * 250, y: Math.floor(index / 5) * 150 },
      data: {
        label: React.createElement(
          "div",
          { className: "flex flex-col items-center p-2" },
          React.createElement(
            "div",
            { className: "flex items-center gap-2 mb-1" },
            React.createElement(
              "span",
              { className: "font-medium" },
              state.name
            ),
            isApproved &&
              React.createElement(Check, {
                className: "h-4 w-4 text-green-600",
              })
          ),
          React.createElement(
            "div",
            { className: "flex gap-1" },
            React.createElement(
              Badge,
              {
                variant: "outline",
                className: `text-xs ${getConfidenceColor(confidenceLevel)}`,
              },
              `${Math.round((state.confidence || 0) * 100)}%`
            ),
            state.is_initial &&
              React.createElement(
                Badge,
                { variant: "outline", className: "text-xs" },
                "Initial"
              ),
            state.is_error_state &&
              React.createElement(
                Badge,
                { variant: "outline", className: "text-xs text-red-600" },
                "Error"
              )
          )
        ),
      },
      style: {
        background: selectedStateIds.has(state.id) ? "#e0f2fe" : "white",
        border: `2px solid ${borderColor}`,
        borderRadius: "8px",
        padding: "10px",
      },
    };
  });
}

function createFlowEdges(
  transitions: DiscoveredTransition[],
  selectedTransitionIds: Set<string>
): Edge[] {
  return transitions
    .filter((t) => t.to_state_id)
    .map((transition) => {
      const confidenceLevel = getConfidenceLevel(transition.confidence);
      const isApproved = transition.user_approved;
      const color = getConfidenceBorderColor(isApproved, confidenceLevel);

      return {
        id: transition.id,
        source: transition.from_state_id,
        target: transition.to_state_id!,
        type: "default",
        animated: selectedTransitionIds.has(transition.id),
        style: {
          stroke: color,
          strokeWidth: selectedTransitionIds.has(transition.id) ? 2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
        },
        label: transition.trigger_type,
        labelStyle: { fontSize: 10, fill: "#666" },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "white", fillOpacity: 0.8 },
      };
    });
}

export function useStateStructure(
  recordingId: string,
  selectedStateIds: Set<string>,
  selectedTransitionIds: Set<string>,
  onLoaded: (stateIds: string[], transitionIds: string[]) => void
) {
  const [structure, setStructure] = useState<DiscoveredStateStructure | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await recordingService.getStateStructure(recordingId);
        setStructure(data);

        const flowNodes = createFlowNodes(data.states, selectedStateIds);
        const flowEdges = createFlowEdges(
          data.transitions,
          selectedTransitionIds
        );

        setNodes(flowNodes);
        setEdges(flowEdges);

        onLoaded(
          data.states.map((s) => s.id),
          data.transitions.map((t) => t.id)
        );
      } catch (error: unknown) {
        console.error("Failed to load state structure:", error);
        toast.error("Failed to load state structure");
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId]);

  useEffect(() => {
    if (!structure) return;
    setNodes(createFlowNodes(structure.states, selectedStateIds));
    setEdges(createFlowEdges(structure.transitions, selectedTransitionIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStateIds, selectedTransitionIds]);

  return {
    structure,
    loading,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
  };
}
