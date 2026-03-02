"use client";

import React from "react";
import { COLORS } from "../canvas-config";
import { HandleTooltipData } from "../tooltip-types";

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

export function HandleTooltip({ data }: { data: HandleTooltipData }) {
  return (
    <div className="space-y-2">
      <div
        className="inline-block text-xs px-2 py-1 rounded font-medium"
        style={{
          backgroundColor: `${typeColors[data.connectionType]}20`,
          color: typeColors[data.connectionType],
        }}
      >
        {typeLabels[data.connectionType]}
      </div>

      <div className="text-xs text-text-muted">
        <span className="text-text-muted">Output:</span> #{data.outputIndex}
      </div>

      <div className="text-xs text-text-muted">
        <span className="text-text-muted">Connections:</span>{" "}
        {data.connectedCount}
      </div>

      {data.description && (
        <div className="text-xs text-text-secondary pt-1 border-t border-border-default">
          {data.description}
        </div>
      )}
    </div>
  );
}
