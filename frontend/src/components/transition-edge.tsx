"use client";

import {
  type EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
} from "@xyflow/react";
import { Badge } from "@/components/ui/badge";

interface TransitionEdgeData {
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
}: EdgeProps<TransitionEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const { transition, isMultiTarget, targetIndex, totalTargets, isIncoming } =
    data || {
      transition: { process: "", staysVisible: false },
      isMultiTarget: false,
      targetIndex: 0,
      totalTargets: 1,
      isIncoming: false,
    };

  // Determine edge styling based on transition type
  const isIncomingTransition =
    isIncoming || transition.type === "IncomingTransition";

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
