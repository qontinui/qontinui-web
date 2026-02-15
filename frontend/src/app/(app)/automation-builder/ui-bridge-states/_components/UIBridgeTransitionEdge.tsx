"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import {
  MousePointer,
  Type as TypeIcon,
  ListFilter,
  Clock,
  Globe,
  Eye,
} from "lucide-react";
import type { TransitionEdgeData, TransitionAction } from "../_types";

const ACTION_ICONS: Record<TransitionAction["type"], typeof MousePointer> = {
  click: MousePointer,
  type: TypeIcon,
  select: ListFilter,
  wait: Clock,
  navigate: Globe,
};

const ACTION_COLORS: Record<TransitionAction["type"], string> = {
  click: "text-blue-400",
  type: "text-amber-400",
  select: "text-purple-400",
  wait: "text-gray-400",
  navigate: "text-cyan-400",
};

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
    selected,
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
  const isActive = isHighlighted || selected;
  const actionTypes = edgeData?.actionTypes ?? [];
  const uniqueActionTypes = [...new Set(actionTypes)];

  return (
    <>
      {/* Invisible wider path for easier clicking */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: "transparent",
          strokeWidth: 20,
          cursor: "pointer",
        }}
      />
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isActive ? "var(--brand-primary)" : "var(--border-secondary)",
          strokeWidth: isActive ? 2.5 : 1.5,
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
      />
      {edgeData?.name && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto cursor-pointer"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <div
              className={`
                flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border shadow-sm
                transition-all duration-150
                ${isActive
                  ? "bg-brand-primary text-white border-brand-primary shadow-brand-primary/20"
                  : "bg-surface-primary/95 text-text-muted border-border-primary hover:border-brand-primary/40 backdrop-blur-sm"
                }
              `}
            >
              {/* Action type icons with color coding */}
              {uniqueActionTypes.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {uniqueActionTypes.slice(0, 3).map((actionType) => {
                    const Icon = ACTION_ICONS[actionType];
                    const colorClass = isActive ? "" : ACTION_COLORS[actionType];
                    return Icon ? (
                      <Icon key={actionType} className={`size-3 ${colorClass}`} />
                    ) : null;
                  })}
                </span>
              )}
              <span className="font-medium max-w-[120px] truncate">{edgeData.name}</span>
              {/* Source element target indicator */}
              {edgeData.firstActionTarget && !isActive && (
                <span className="opacity-50 text-[8px] max-w-[60px] truncate">
                  {edgeData.firstActionTarget}
                </span>
              )}
              {edgeData.pathCost !== 1.0 && (
                <span className="opacity-60 text-[9px]">
                  cost:{edgeData.pathCost}
                </span>
              )}
              {/* Action count badge when multiple actions */}
              {edgeData.actionCount > 1 && (
                <span className={`text-[8px] px-1 rounded-full ${isActive ? "bg-white/20" : "bg-surface-secondary"}`}>
                  {edgeData.actionCount}
                </span>
              )}
              {/* Stays visible indicator */}
              {edgeData.staysVisible && (
                <Eye className={`size-3 ${isActive ? "text-green-200" : "text-green-400"}`} />
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const UIBridgeTransitionEdge = memo(UIBridgeTransitionEdgeInner);
