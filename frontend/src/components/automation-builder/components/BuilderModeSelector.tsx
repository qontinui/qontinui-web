/**
 * BuilderModeSelector Component
 *
 * Toggle between Sequential and Graph modes with visual feedback.
 * Features color-coded modes (cyan for sequential, green for graph) and smooth transitions.
 */

import React from "react";
import { List as ListIcon, Workflow as WorkflowIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BuilderMode } from "../types";

export interface BuilderModeSelectorProps {
  mode: BuilderMode;
  onModeChange: (mode: BuilderMode) => void;
  disabled?: boolean;
  className?: string;
}

export function BuilderModeSelector({
  mode,
  onModeChange,
  disabled = false,
  className,
}: BuilderModeSelectorProps) {
  const isSequential = mode === "sequential";

  return (
    <div
      className={cn(
        "flex items-center gap-1 p-1 bg-surface-canvas rounded-lg",
        className
      )}
    >
      {/* Sequential Mode Button */}
      <button
        onClick={() => onModeChange("sequential")}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all duration-200",
          "hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed",
          isSequential
            ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
            : "text-text-muted border border-transparent"
        )}
        title="Sequential mode - Linear, step-by-step processes"
        data-ui-id="automation-mode-sequential-btn"
      >
        <ListIcon className="w-4 h-4" />
        <span className="text-sm">Sequential</span>
      </button>

      {/* Graph Mode Button */}
      <button
        onClick={() => onModeChange("graph")}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all duration-200",
          "hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed",
          !isSequential
            ? "bg-brand-success/10 text-brand-success border border-brand-success/30"
            : "text-text-muted border border-transparent"
        )}
        title="Graph mode - Visual workflows with branching and loops"
        data-ui-id="automation-mode-graph-btn"
      >
        <WorkflowIcon className="w-4 h-4" />
        <span className="text-sm">Graph</span>
      </button>
    </div>
  );
}

/**
 * Compact variant without labels
 */
export interface CompactModeSelectorProps extends BuilderModeSelectorProps {
  showTooltips?: boolean;
}

export function CompactModeSelector({
  mode,
  onModeChange,
  disabled = false,
  showTooltips = true,
  className,
}: CompactModeSelectorProps) {
  const isSequential = mode === "sequential";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 p-0.5 bg-surface-canvas rounded-md",
        className
      )}
    >
      <button
        onClick={() => onModeChange("sequential")}
        disabled={disabled}
        className={cn(
          "p-2 rounded transition-all duration-200",
          "hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed",
          isSequential
            ? "bg-brand-primary/10 text-brand-primary"
            : "text-text-muted"
        )}
        title={showTooltips ? "Sequential mode" : undefined}
      >
        <ListIcon className="w-4 h-4" />
      </button>
      <button
        onClick={() => onModeChange("graph")}
        disabled={disabled}
        className={cn(
          "p-2 rounded transition-all duration-200",
          "hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed",
          !isSequential
            ? "bg-brand-success/10 text-brand-success"
            : "text-text-muted"
        )}
        title={showTooltips ? "Graph mode" : undefined}
      >
        <WorkflowIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
