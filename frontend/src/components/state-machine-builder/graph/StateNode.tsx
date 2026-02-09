"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Globe, Maximize2, Layout, AlertTriangle } from "lucide-react";
import type {
  UIBridgeState,
  BuilderMode,
} from "@/lib/state-machine-builder/types";

interface StateNodeData extends Record<string, unknown> {
  state: UIBridgeState;
  selected: boolean;
  hasIssue?: boolean;
  mode?: BuilderMode;
}

function getStateTypeConfig(state: UIBridgeState) {
  if (state.isGlobal) {
    return {
      borderClass: "border-green-500/50",
      ringClass: "ring-green-500/30",
      Icon: Globe,
      label: "global",
    };
  }
  if (state.isModal) {
    return {
      borderClass: "border-purple-500/50",
      ringClass: "ring-purple-500/30",
      Icon: Maximize2,
      label: "modal",
    };
  }
  return {
    borderClass: "border-[var(--brand-secondary)]/50",
    ringClass: "ring-[var(--brand-secondary)]/30",
    Icon: Layout,
    label: "content",
  };
}

export const StateNode = memo(function StateNode({
  data,
}: NodeProps & { data: StateNodeData }) {
  const { state, selected, hasIssue, mode } = data as StateNodeData;
  const { borderClass, ringClass, Icon } = getStateTypeConfig(state);
  const elementCount = state.elements?.length ?? 0;
  const zone = state.positionZone || "content";
  const isEditMode = mode === "edit";

  return (
    <div
      className={[
        "min-w-[180px] rounded-lg bg-surface-raised border-2 px-3 py-2 shadow-sm transition-shadow group",
        hasIssue ? "border-amber-500/60" : borderClass,
        selected
          ? `ring-2 ring-offset-1 ring-offset-transparent ${ringClass}`
          : "",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={[
          "!bg-[var(--brand-secondary)] !border-none transition-all",
          isEditMode
            ? "!w-3 !h-3 !opacity-0 group-hover:!opacity-100"
            : "!w-2 !h-2",
        ].join(" ")}
      />

      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0 text-text-muted" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {state.name}
        </span>
        {hasIssue && (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        {elementCount > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {elementCount}
          </Badge>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-text-muted capitalize">{zone}</span>
        {state.confidence != null && (
          <div className="flex items-center gap-1.5">
            <div className="w-12 h-1 rounded-full bg-surface-raised border border-border-subtle overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--brand-primary)]"
                style={{ width: `${Math.round(state.confidence * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-text-muted">
              {Math.round(state.confidence * 100)}%
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className={[
          "!bg-[var(--brand-secondary)] !border-none transition-all",
          isEditMode
            ? "!w-3 !h-3 !opacity-0 group-hover:!opacity-100"
            : "!w-2 !h-2",
        ].join(" ")}
      />
    </div>
  );
});
