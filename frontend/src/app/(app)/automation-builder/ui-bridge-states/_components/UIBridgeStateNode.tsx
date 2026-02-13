"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers, Lock } from "lucide-react";
import type { StateNodeData } from "../_types";

function UIBridgeStateNodeInner({ data }: NodeProps) {
  const nodeData = data as unknown as StateNodeData;
  const {
    name,
    elementCount,
    confidence,
    isBlocking,
    isSelected,
  } = nodeData;

  const confidencePercent = Math.round(confidence * 100);

  return (
    <div
      className={`
        rounded-lg border-2 px-4 py-3 min-w-[180px] max-w-[240px] shadow-sm
        transition-all duration-150
        ${isSelected
          ? "border-brand-primary bg-surface-secondary ring-2 ring-brand-primary/30"
          : isBlocking
            ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
            : "border-border-primary bg-surface-primary hover:border-brand-primary/50"
        }
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-brand-primary !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-1">
        {isBlocking ? (
          <Lock className="size-3.5 text-amber-500 shrink-0" />
        ) : (
          <Layers className="size-3.5 text-brand-primary shrink-0" />
        )}
        <span className="text-sm font-medium text-text-primary truncate">
          {name}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="badge badge-sm badge-default">
          {elementCount} elements
        </span>
        <span
          className={`badge badge-sm ${
            confidencePercent >= 80
              ? "badge-success"
              : confidencePercent >= 50
                ? "badge-warning"
                : "badge-danger"
          }`}
        >
          {confidencePercent}%
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-brand-primary !w-2 !h-2" />
    </div>
  );
}

export const UIBridgeStateNode = memo(UIBridgeStateNodeInner);
