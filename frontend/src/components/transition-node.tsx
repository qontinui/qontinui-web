"use client";

import { type NodeProps, Handle, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

interface TransitionNodeData {
  transition: {
    id: string;
    type: "OutgoingTransition" | "IncomingTransition";
    fromState?: string;
    toState?: string;
    activateStates?: string[];
    deactivateStates?: string[];
    workflows?: string[];
    process?: string;
    staysVisible?: boolean;
  };
  label: string;
  isSingleTarget?: boolean;
  isIncoming?: boolean;
}

export function TransitionNode({
  data,
  selected,
}: NodeProps<TransitionNodeData>) {
  const { transition, label, isSingleTarget = false, isIncoming = false } = data || {
    transition: { id: "", type: "OutgoingTransition" as const, workflows: [] },
    label: "",
    isSingleTarget: false,
    isIncoming: false,
  };

  // Determine color based on transition type
  const color =
    isIncoming || transition.type === "IncomingTransition"
      ? "#00FF88" // Green for incoming
      : "#BD00FF"; // Magenta for outgoing

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#555" }}
      />

      <div
        className={`
          transition-all duration-200 rounded-full p-2
          ${selected ? `shadow-lg scale-110` : `hover:shadow-md`}
        `}
        style={{
          backgroundColor: selected ? color : `${color}cc`,
          boxShadow: selected
            ? `0 10px 15px -3px ${color}80, 0 4px 6px -2px ${color}80`
            : undefined,
        }}
      >
        <div className="flex items-center justify-center">
          {isSingleTarget ? (
            // Single arrow pointing down
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 3 L8 11 M5 8 L8 11 L11 8"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            // Two arrows diverging down-left and down-right
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 5 L4 11 M8 5 L12 11 M2 9 L4 11 L6 9 M10 9 L12 11 L14 9"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Show workflow indicator if has workflows */}
        {transition.workflows && transition.workflows.length > 0 && (
          <div className="absolute -top-2 -right-2">
            <div className="bg-[#00D9FF] rounded-full p-1">
              <Zap className="w-3 h-3 text-black" />
            </div>
          </div>
        )}

        {/* Show stays visible indicator (only for outgoing transitions) */}
        {transition.staysVisible && !isIncoming && (
          <div className="absolute -bottom-2 -right-2">
            <div className="bg-[#00FF88] rounded-full w-2 h-2" />
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#555" }}
      />

      {/* Hover tooltip */}
      <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
        <Badge className="bg-black/80 text-white text-xs whitespace-nowrap">
          {label}
        </Badge>
      </div>
    </>
  );
}
