"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { TransitionEdgeData } from "../_types";

function UIBridgeTransitionEdgeInner(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
  } = props;

  const edgeData = data as unknown as TransitionEdgeData;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isHighlighted = edgeData?.isHighlighted ?? false;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isHighlighted ? "var(--brand-primary)" : "var(--border-secondary)",
          strokeWidth: isHighlighted ? 2.5 : 1.5,
        }}
      />
      {edgeData?.name && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <div
              className={`
                text-[10px] px-2 py-0.5 rounded-full border shadow-sm
                ${isHighlighted
                  ? "bg-brand-primary text-white border-brand-primary"
                  : "bg-surface-primary text-text-muted border-border-primary"
                }
              `}
            >
              {edgeData.name}
              {edgeData.pathCost !== 1.0 && (
                <span className="ml-1 opacity-70">({edgeData.pathCost})</span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const UIBridgeTransitionEdge = memo(UIBridgeTransitionEdgeInner);
