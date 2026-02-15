"use client";

import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Layers,
  Lock,
  Play,
  MousePointer,
  Type as TypeIcon,
  Globe,
  Hash,
  Box,
  ArrowUpRight,
  ArrowDownLeft,
  Link2,
} from "lucide-react";
import type { StateNodeData } from "../_types";

// Size tiers for dynamic node sizing based on element count
// Adapted from GUI Build StateNode with 4 tiers
const SIZE_TIERS = {
  small: { cardWidth: 200, gridCols: 3, gridMaxWidth: 170, maxElements: 6 },
  medium: { cardWidth: 260, gridCols: 4, gridMaxWidth: 224, maxElements: 12 },
  large: { cardWidth: 320, gridCols: 5, gridMaxWidth: 280, maxElements: 20 },
  xlarge: { cardWidth: 380, gridCols: 6, gridMaxWidth: 340, maxElements: 30 },
};

function getCardSize(elementCount: number) {
  if (elementCount <= 4) return SIZE_TIERS.small;
  if (elementCount <= 10) return SIZE_TIERS.medium;
  if (elementCount <= 18) return SIZE_TIERS.large;
  return SIZE_TIERS.xlarge;
}

/** Get icon and color for an element ID based on its prefix/type */
export function getElementStyle(elementId: string) {
  if (elementId.startsWith("testid:")) {
    return { icon: Hash, color: "text-blue-400", bg: "bg-blue-500/15", border: "border-blue-500/25", hoverBg: "hover:bg-blue-500/25", label: elementId.slice(7), prefix: "testid" };
  }
  if (elementId.startsWith("role:")) {
    return { icon: MousePointer, color: "text-green-400", bg: "bg-green-500/15", border: "border-green-500/25", hoverBg: "hover:bg-green-500/25", label: elementId.slice(5), prefix: "role" };
  }
  if (elementId.startsWith("text:")) {
    return { icon: TypeIcon, color: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/25", hoverBg: "hover:bg-amber-500/25", label: elementId.slice(5), prefix: "text" };
  }
  if (elementId.startsWith("ui:")) {
    return { icon: Box, color: "text-purple-400", bg: "bg-purple-500/15", border: "border-purple-500/25", hoverBg: "hover:bg-purple-500/25", label: elementId.slice(3), prefix: "ui" };
  }
  if (elementId.startsWith("url:") || elementId.startsWith("nav:")) {
    return { icon: Globe, color: "text-cyan-400", bg: "bg-cyan-500/15", border: "border-cyan-500/25", hoverBg: "hover:bg-cyan-500/25", label: elementId.slice(4), prefix: "url" };
  }
  return { icon: Layers, color: "text-gray-400", bg: "bg-gray-500/15", border: "border-gray-500/25", hoverBg: "hover:bg-gray-500/25", label: elementId, prefix: "other" };
}

/** Summarize element types for the stats row */
function summarizeElementTypes(elementIds: string[]): { prefix: string; count: number; color: string }[] {
  const counts = new Map<string, number>();
  for (const eid of elementIds) {
    const style = getElementStyle(eid);
    counts.set(style.prefix, (counts.get(style.prefix) ?? 0) + 1);
  }
  const prefixColors: Record<string, string> = {
    testid: "text-blue-400",
    role: "text-green-400",
    text: "text-amber-400",
    ui: "text-purple-400",
    url: "text-cyan-400",
    other: "text-gray-400",
  };
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([prefix, count]) => ({
      prefix,
      count,
      color: prefixColors[prefix] ?? "text-gray-400",
    }));
}

function UIBridgeStateNodeInner({ data }: NodeProps) {
  const nodeData = data as unknown as StateNodeData;
  const {
    stateId,
    name,
    elementCount,
    confidence,
    elementIds,
    description,
    isBlocking,
    isSelected,
    isInitial,
    onStartElementDrag,
    outgoingCount,
    incomingCount,
  } = nodeData;

  const confidencePercent = Math.round(confidence * 100);
  const cardSize = getCardSize(elementCount);
  const elementSummary = useMemo(() => summarizeElementTypes(elementIds), [elementIds]);

  // Determine if this node has any connections at all
  const hasConnections = (outgoingCount ?? 0) > 0 || (incomingCount ?? 0) > 0;

  return (
    <div style={{ width: cardSize.cardWidth }} data-id={stateId}>
      {/* Target handle - styled with connection indicator */}
      <Handle
        type="target"
        position={Position.Top}
        className={`!w-3 !h-3 !border-2 !border-surface-primary ${
          isSelected ? "!bg-brand-primary !shadow-sm !shadow-brand-primary/40" : "!bg-brand-primary"
        }`}
      />

      <div
        className={`
          rounded-lg border-2 px-3 py-2.5 shadow-md
          transition-all duration-150 relative
          ${isSelected
            ? "border-brand-primary bg-surface-secondary ring-2 ring-brand-primary/30 shadow-brand-primary/20 shadow-lg"
            : isBlocking
              ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20 shadow-amber-500/10"
              : "border-border-primary bg-surface-primary hover:border-brand-primary/50 hover:shadow-lg"
          }
        `}
      >
        {/* Initial state badge */}
        {isInitial && (
          <div className="absolute -top-3 -left-3 z-10">
            <div className="flex items-center gap-0.5 bg-[#FFD700] text-black text-[9px] font-bold px-2 py-0.5 rounded-full shadow-md shadow-yellow-500/30">
              <Play className="size-2.5 fill-current" />
              <span>START</span>
            </div>
          </div>
        )}

        {/* Transition count indicators */}
        {(outgoingCount ?? 0) > 0 && (
          <div className="absolute -top-2 -right-2 z-10">
            <div className="flex items-center gap-0.5 bg-brand-secondary/90 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm" title={`${outgoingCount} outgoing transition${outgoingCount !== 1 ? "s" : ""}`}>
              <ArrowUpRight className="size-2" />
              <span>{outgoingCount}</span>
            </div>
          </div>
        )}
        {(incomingCount ?? 0) > 0 && (
          <div className="absolute -bottom-2 -right-2 z-10">
            <div className="flex items-center gap-0.5 bg-brand-primary/90 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm" title={`${incomingCount} incoming transition${incomingCount !== 1 ? "s" : ""}`}>
              <ArrowDownLeft className="size-2" />
              <span>{incomingCount}</span>
            </div>
          </div>
        )}

        {/* No connections indicator */}
        {!hasConnections && elementIds.length > 0 && (
          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-10">
            <div className="flex items-center gap-0.5 bg-surface-secondary/90 text-text-muted text-[7px] px-1.5 py-0.5 rounded-full shadow-sm border border-border-primary" title="No transitions — drag an element to another state to create one">
              <Link2 className="size-2" />
              <span>no links</span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          {isBlocking ? (
            <Lock className="size-3.5 text-amber-500 shrink-0" />
          ) : (
            <Layers className="size-3.5 text-brand-primary shrink-0" />
          )}
          <span className="text-sm font-semibold text-text-primary truncate flex-1">
            {name}
          </span>
        </div>

        {/* Description (if short) */}
        {description && (
          <p className="text-[10px] text-text-muted mb-1.5 line-clamp-2">
            {description}
          </p>
        )}

        {/* Element thumbnail grid */}
        {elementIds.length > 0 && (
          <div
            className="grid gap-0.5 mb-2 mx-auto"
            style={{
              gridTemplateColumns: `repeat(${cardSize.gridCols}, 1fr)`,
              maxWidth: cardSize.gridMaxWidth,
            }}
          >
            {elementIds.slice(0, cardSize.maxElements).map((elementId) => {
              const style = getElementStyle(elementId);
              const Icon = style.icon;
              return (
                <div
                  key={elementId}
                  className={`
                    relative group rounded px-1 py-0.5 text-[8px] truncate
                    ${style.bg} ${style.color} border ${style.border}
                    ${style.hoverBg} hover:shadow-sm hover:z-10
                    ${onStartElementDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
                    transition-all duration-100
                  `}
                  title={`${elementId}\n${onStartElementDrag ? "Drag to create transition • Alt+drag to move" : ""}`}
                  draggable={!!onStartElementDrag}
                  onDragStart={(e) => {
                    if (!onStartElementDrag) return;
                    e.stopPropagation();
                    const isMoveOperation = e.altKey;
                    e.dataTransfer.setData(
                      "application/ui-bridge-element-drag",
                      JSON.stringify({
                        sourceStateId: stateId,
                        elementId,
                        isMoveOperation,
                      })
                    );
                    e.dataTransfer.effectAllowed = isMoveOperation ? "move" : "link";
                    onStartElementDrag(stateId, elementId);
                  }}
                >
                  <div className="flex items-center gap-0.5">
                    <Icon className="size-2.5 shrink-0" />
                    <span className="truncate">{style.label}</span>
                  </div>
                  {/* Drag handle indicator */}
                  {onStartElementDrag && (
                    <div
                      className="nodrag absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-brand-secondary/60 hover:bg-brand-secondary opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-sm"
                      title="Drag to create transition. Alt+drag to move element."
                    />
                  )}
                </div>
              );
            })}
            {/* Overflow indicator */}
            {elementIds.length > cardSize.maxElements && (
              <div className="rounded px-1 py-0.5 text-[8px] bg-surface-secondary text-text-muted flex items-center justify-center border border-border-primary">
                +{elementIds.length - cardSize.maxElements}
              </div>
            )}
          </div>
        )}

        {/* Stats row - enhanced with element type summary */}
        <div className="flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-1.5">
            <span className="badge badge-sm badge-default">
              {elementCount} el
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
          {/* Element type breakdown - sorted by count */}
          {elementSummary.length > 1 && (
            <div className="flex items-center gap-1">
              {elementSummary.slice(0, 4).map(({ prefix, count, color }) => {
                const Icon = getElementStyle(`${prefix}:x`).icon;
                return (
                  <span key={prefix} className={`flex items-center gap-0.5 text-[8px] ${color}`} title={`${count} ${prefix} elements`}>
                    <Icon className="size-2" />
                    {count}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Source handle - styled with connection indicator */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={`!w-3 !h-3 !border-2 !border-surface-primary ${
          isSelected ? "!bg-brand-secondary !shadow-sm !shadow-brand-secondary/40" : "!bg-brand-secondary"
        }`}
      />
    </div>
  );
}

export const UIBridgeStateNode = memo(UIBridgeStateNodeInner);
