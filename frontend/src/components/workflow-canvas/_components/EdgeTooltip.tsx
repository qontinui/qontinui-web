"use client";

import React from "react";
import { COLORS } from "../canvas-config";
import { EdgeTooltipData } from "../tooltip-types";

const typeColors: Record<"main" | "error" | "success" | "parallel", string> = {
  main: COLORS.main,
  error: COLORS.error,
  success: COLORS.success,
  parallel: COLORS.main,
};

const typeLabels: Record<"main" | "error" | "success" | "parallel", string> = {
  main: "Main Flow",
  error: "Error Handling",
  success: "Success Condition",
  parallel: "Parallel Flow",
};

export function EdgeTooltip({ data }: { data: EdgeTooltipData }) {
  return (
    <div className="space-y-2">
      <div className="text-sm">
        <div className="text-text-muted text-xs mb-1">Connection:</div>
        <div className="flex items-center gap-2">
          <span className="text-white font-medium truncate max-w-[100px]">
            {data.sourceNode}
          </span>
          <svg
            className="w-4 h-4 text-text-muted flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-white font-medium truncate max-w-[100px]">
            {data.targetNode}
          </span>
        </div>
      </div>

      <div
        className="inline-block text-xs px-2 py-1 rounded font-medium"
        style={{
          backgroundColor: `${typeColors[data.connectionType]}20`,
          color: typeColors[data.connectionType],
        }}
      >
        {typeLabels[data.connectionType]}
      </div>

      {data.executionCount !== undefined && (
        <div className="text-xs text-text-muted">
          <span className="text-text-muted">Executed:</span>{" "}
          {data.executionCount} times
        </div>
      )}

      {data.lastExecuted && (
        <div className="text-xs text-text-muted">
          <span className="text-text-muted">Last run:</span>{" "}
          {data.lastExecuted.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
