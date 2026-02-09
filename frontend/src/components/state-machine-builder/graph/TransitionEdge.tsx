"use client";

import {
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";

interface TransitionEdgeData extends Record<string, unknown> {
  action?: {
    type: string;
    element?: string;
  };
  count?: number;
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
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = data as TransitionEdgeData | undefined;
  const actionType = edgeData?.action?.type;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: "var(--brand-secondary)",
          strokeWidth: 2,
          ...style,
        }}
      />
      {actionType && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <span className="inline-flex items-center rounded-full bg-surface-raised border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-text-muted shadow-sm">
              {actionType}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
