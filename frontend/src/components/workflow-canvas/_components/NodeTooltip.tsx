"use client";

import React from "react";
import { COLORS } from "../canvas-config";
import { NodeTooltipData } from "../tooltip-types";

const statusColors = {
  idle: COLORS.idle,
  running: COLORS.running,
  success: COLORS.successState,
  error: COLORS.errorState,
  warning: COLORS.warning,
};

const statusIcons = {
  idle: "●",
  running: "◌",
  success: "✓",
  error: "✕",
  warning: "⚠",
};

export function NodeTooltip({ data }: { data: NodeTooltipData }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">
            {data.actionName}
          </div>
          <div className="text-xs text-text-muted">{data.actionType}</div>
        </div>
        {data.executionState && (
          <div
            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{
              backgroundColor: `${statusColors[data.executionState]}20`,
              color: statusColors[data.executionState],
            }}
          >
            <span>{statusIcons[data.executionState]}</span>
            <span className="capitalize">{data.executionState}</span>
          </div>
        )}
      </div>

      {(data.inputCount !== undefined || data.outputCount !== undefined) && (
        <div className="flex gap-4 text-xs text-text-muted">
          {data.inputCount !== undefined && (
            <div>
              <span className="text-text-muted">Inputs:</span> {data.inputCount}
            </div>
          )}
          {data.outputCount !== undefined && (
            <div>
              <span className="text-text-muted">Outputs:</span>{" "}
              {data.outputCount}
            </div>
          )}
        </div>
      )}

      {data.executionDuration !== undefined && (
        <div className="text-xs text-text-muted">
          <span className="text-text-muted">Duration:</span>{" "}
          {data.executionDuration}ms
        </div>
      )}

      {data.errorMessage && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded">
          {data.errorMessage}
        </div>
      )}

      {data.disabled && (
        <div className="text-xs text-text-muted italic">
          This node is disabled
        </div>
      )}

      <div className="pt-1 border-t border-border-default">
        <span className="inline-block text-xs px-2 py-1 bg-surface-raised rounded text-text-muted">
          {data.category}
        </span>
      </div>
    </div>
  );
}
