"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, Clock, Variable } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionLogProps } from "../_types/orchestrator-types";
import { formatValue } from "../orchestrator-utils";
import { StepResultCard } from "./StepResultCard";

export function ExecutionLog({ result }: ExecutionLogProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(
    new Set(result.failed_at_step !== undefined ? [result.failed_at_step] : [])
  );

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div
        className={cn(
          "flex items-center justify-between p-3 rounded-md border",
          result.success
            ? "bg-emerald-500/5 border-emerald-500/20"
            : "bg-red-500/5 border-red-500/20"
        )}
      >
        <div className="flex items-center gap-2">
          {result.success ? (
            <Check className="size-4 text-emerald-400" />
          ) : (
            <X className="size-4 text-red-400" />
          )}
          <span
            className={cn(
              "text-sm font-medium",
              result.success ? "text-emerald-400" : "text-red-400"
            )}
          >
            {result.success ? "Execution Successful" : "Execution Failed"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {result.total_duration_ms}ms
          </span>
          <span>
            {result.step_results.filter((s) => s.success).length}/
            {result.step_results.length} passed
          </span>
        </div>
      </div>

      {/* Expand/Collapse */}
      <div className="flex items-center gap-2 text-xs">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-text-muted"
          onClick={() =>
            setExpandedSteps(new Set(result.step_results.map((_, i) => i)))
          }
        >
          Expand All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-text-muted"
          onClick={() => setExpandedSteps(new Set())}
        >
          Collapse All
        </Button>
      </div>

      {/* All variables */}
      {Object.keys(result.all_variables).length > 0 && (
        <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-md">
          <div className="flex items-center gap-2 text-xs font-medium text-purple-400 uppercase tracking-wider mb-2">
            <Variable className="size-3.5" />
            All Extracted Variables
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(result.all_variables).map(([name, value]) => (
              <div
                key={name}
                className="px-2 py-1 bg-surface-canvas/50 rounded text-xs font-mono"
              >
                <span className="text-purple-400">{name}</span>
                <span className="text-text-muted"> = </span>
                <span className="text-text-secondary">
                  {formatValue(value, 50)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step results */}
      <div className="space-y-1.5">
        {result.step_results.map((step, idx) => (
          <StepResultCard
            key={idx}
            step={step}
            isExpanded={expandedSteps.has(idx)}
            onToggle={() => toggleStep(idx)}
          />
        ))}
      </div>
    </div>
  );
}
