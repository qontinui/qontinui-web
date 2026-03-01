/**
 * BaseNode - Shared component for all workflow nodes
 *
 * Provides common features:
 * - Node header with icon and type
 * - Node body with summary
 * - Connection handles (inputs/outputs)
 * - Selection state styling
 * - Error state indicator
 * - Execution state indicator (running/completed/failed)
 * - Hover effects
 */

import React from "react";
import {
  Handle,
  Position,
  NodeProps,
  Node as ReactFlowNode,
} from "@xyflow/react";
import { Action } from "@/lib/action-schema/action-types";
import { getNodeIcon } from "./node-icons";
import {
  getNodeSummary,
  getNodeCategory,
  getCategoryColor,
} from "./node-utils";

export interface BaseNodeData extends Record<string, unknown> {
  action: Action;
  executionState?: "idle" | "running" | "completed" | "failed" | "skipped";
  error?: string;
  outputCount?: number;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
}

export interface BaseNodeProps extends NodeProps<ReactFlowNode<BaseNodeData>> {
  showInputHandle?: boolean;
  showOutputHandle?: boolean;
  outputHandleIds?: string[];
  className?: string;
  compact?: boolean;
}

/**
 * Base node component used by all action type nodes
 */
export function BaseNode({
  id,
  data,
  selected,
  showInputHandle = true,
  showOutputHandle = true,
  outputHandleIds = ["main-0"],
  className = "",
  compact = false,
}: BaseNodeProps) {
  const action = data?.action;
  const executionState = data?.executionState ?? "idle";
  const error = data?.error;

  if (!action) {
    return null;
  }

  const category = getNodeCategory(action.type);
  const categoryColor = getCategoryColor(category);
  const Icon = getNodeIcon(action.type);
  const summary = getNodeSummary(action);

  const handleClick = () => {
    data.onNodeClick?.(id);
  };

  const handleDoubleClick = () => {
    data.onNodeDoubleClick?.(id);
  };

  // Get execution state styles
  const getExecutionStateStyles = () => {
    switch (executionState) {
      case "running":
        return "ring-2 ring-blue-500 ring-offset-2 animate-pulse";
      case "completed":
        return "ring-2 ring-green-500 ring-offset-2";
      case "failed":
        return "ring-2 ring-red-500 ring-offset-2";
      case "skipped":
        return "opacity-50";
      default:
        return "";
    }
  };

  // Get selection styles
  const getSelectionStyles = () => {
    if (selected) {
      return "ring-2 ring-blue-400 ring-offset-2";
    }
    return "";
  };

  return (
    <div
      className={`
        workflow-node
        base-node
        ${categoryColor}
        ${getExecutionStateStyles()}
        ${getSelectionStyles()}
        ${compact ? "compact" : ""}
        ${className}
        relative rounded-lg bg-white border-2 border-border-default
        shadow-md hover:shadow-lg transition-all duration-200
        min-w-[180px] max-w-[280px]
        cursor-pointer
      `}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Input Handle */}
      {showInputHandle && (
        <Handle
          type="target"
          position={Position.Left}
          id="input-0"
          className="node-handle node-handle-input"
          style={{
            width: "16px",
            height: "16px",
            background: "#666",
            border: "2px solid #fff",
            cursor: "crosshair",
          }}
        />
      )}

      {/* Node Header */}
      <div
        className={`
        node-header
        px-3 py-2
        border-b border-border-subtle
        flex items-center gap-2
        ${categoryColor}
      `}
      >
        {/* Icon */}
        <div className="node-icon flex-shrink-0">
          <Icon className="w-4 h-4" />
        </div>

        {/* Type and Name */}
        <div className="flex-1 min-w-0">
          <div className="node-type text-xs font-semibold text-text-secondary uppercase tracking-wide">
            {action.type.replace(/_/g, " ")}
          </div>
          {action.name && !compact && (
            <div className="node-name text-xs text-text-muted truncate">
              {action.name}
            </div>
          )}
        </div>

        {/* Execution State Indicator */}
        {executionState !== "idle" && (
          <div className="execution-indicator flex-shrink-0">
            {executionState === "running" && (
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            )}
            {executionState === "completed" && (
              <div className="w-2 h-2 rounded-full bg-green-500" />
            )}
            {executionState === "failed" && (
              <div className="w-2 h-2 rounded-full bg-red-500" />
            )}
            {executionState === "skipped" && (
              <div className="w-2 h-2 rounded-full bg-text-muted" />
            )}
          </div>
        )}
      </div>

      {/* Node Body */}
      <div
        className={`
        node-body
        px-3 py-2
        ${compact ? "py-1" : "py-2"}
      `}
      >
        <div className="node-summary text-sm text-text-secondary">
          {summary}
        </div>

        {/* Error Message */}
        {error && (
          <div className="node-error mt-2 px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Output Handles */}
      {showOutputHandle && (
        <>
          {outputHandleIds.map((handleId, index) => {
            const totalHandles = outputHandleIds.length;
            const spacing = 100 / (totalHandles + 1);
            const topPercent = spacing * (index + 1);

            return (
              <Handle
                key={handleId}
                type="source"
                position={Position.Right}
                id={handleId}
                className="node-handle node-handle-output"
                style={{
                  top: `${topPercent}%`,
                  width: "16px",
                  height: "16px",
                  background: "#666",
                  border: "2px solid #fff",
                  cursor: "crosshair",
                }}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * Multi-output node variant with labeled handles
 */
export interface MultiOutputNodeProps extends BaseNodeProps {
  outputLabels: Array<{ id: string; label: string; color?: string }>;
}

export function MultiOutputNode({
  outputLabels,
  ...props
}: MultiOutputNodeProps) {
  const outputHandleIds = outputLabels.map((o) => o.id);

  return (
    <div className="relative">
      <BaseNode {...props} outputHandleIds={outputHandleIds} />

      {/* Output Labels */}
      <div className="absolute right-0 top-0 h-full pointer-events-none">
        {outputLabels.map((output, index) => {
          const totalHandles = outputLabels.length;
          const spacing = 100 / (totalHandles + 1);
          const topPercent = spacing * (index + 1);

          return (
            <div
              key={output.id}
              className="absolute right-full mr-2 -translate-y-1/2"
              style={{ top: `${topPercent}%` }}
            >
              <span
                className={`
                  px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap
                  ${output.color || "bg-surface-raised text-text-secondary"}
                `}
              >
                {output.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact node variant for simple actions
 */
export function CompactNode(props: BaseNodeProps) {
  return <BaseNode {...props} compact={true} />;
}

/**
 * Start/End node variant with special styling
 */
export interface TerminalNodeProps extends BaseNodeProps {
  variant: "start" | "end";
}

export function TerminalNode({ variant, ...props }: TerminalNodeProps) {
  const isStart = variant === "start";

  return (
    <div
      className={`
      terminal-node
      ${isStart ? "start-node" : "end-node"}
    `}
    >
      <BaseNode
        {...props}
        showInputHandle={!isStart}
        showOutputHandle={isStart}
        className={`
          ${isStart ? "bg-green-50 border-green-400" : "bg-red-50 border-red-400"}
          font-semibold
        `}
      />
    </div>
  );
}
