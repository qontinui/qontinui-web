"use client";

import {
  type EdgeProps,
  type Edge as ReactFlowEdge,
  getBezierPath,
} from "@xyflow/react";

interface TransitionEdgeData extends Record<string, unknown> {
  transition: {
    id: string;
    type?: "OutgoingTransition" | "IncomingTransition";
    fromState?: string;
    toState?: string;
    activateStates?: string[];
    deactivateStates?: string[];
    process?: string;
    workflows?: string[];
    staysVisible?: boolean;
  };
  isMultiTarget?: boolean;
  targetIndex?: number;
  totalTargets?: number;
  isIncoming?: boolean;
}

export function TransitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ReactFlowEdge<TransitionEdgeData>>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const transition = data?.transition ?? { process: "", staysVisible: false };
  const isIncoming = data?.isIncoming ?? false;

  // Determine edge styling based on transition type
  const isIncomingTransition =
    isIncoming || ("type" in transition && transition.type === "IncomingTransition");

  // Edge colors
  const normalColor = isIncomingTransition ? "#00FF88" : "#BD00FF"; // Green for incoming, Magenta for outgoing
  const selectedColor = "#00D9FF"; // Cyan when selected

  // Check if this is an outgoing transition's target edge (the dotted purple ones)
  const isOutgoingTargetEdge = !isIncomingTransition && id.includes("-target-");

  return (
    <>
      {/* Invisible wider path for easier clicking */}
      <path
        style={{
          stroke: "transparent",
          strokeWidth: 20,
          fill: "none",
          pointerEvents: "stroke",
          cursor: "pointer",
        }}
        d={edgePath}
      />
      <path
        id={id}
        style={{
          stroke: selected ? selectedColor : normalColor,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: isOutgoingTargetEdge ? "5 5" : undefined,
          fill: "none",
          pointerEvents: "stroke",
          cursor: "pointer",
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd="url(#react-flow__arrowclosed)"
      />

      {/* Don't show any badges on edges since we're using transition nodes for all transitions */}
    </>
  );
}
