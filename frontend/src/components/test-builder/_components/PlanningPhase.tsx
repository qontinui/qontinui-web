"use client";

import { Loader2 } from "lucide-react";
import type { PlanningPhaseProps } from "../_types/orchestrator-types";
import { PlanVisualization } from "./PlanVisualization";

export function PlanningPhase({
  plan,
  planning,
  selectedCount,
}: PlanningPhaseProps) {
  if (planning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <Loader2 className="size-10 text-purple-400 animate-spin mb-4" />
        <p className="text-sm text-text-primary font-medium">
          AI is creating your execution plan...
        </p>
        <p className="text-xs text-text-muted mt-2">
          Analyzing {selectedCount} requests and planning variable chaining
        </p>
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div className="p-4 space-y-4">
      {/* Plan Explanation */}
      <div className="p-3 rounded-md bg-purple-500/5 border border-purple-500/20">
        <p className="text-sm text-text-secondary">{plan.explanation}</p>
      </div>

      {/* Plan Visualization */}
      <PlanVisualization plan={plan} currentStepIndex={-1} />

      {/* Verification Suggestions */}
      {plan.verification_suggestions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Suggested Verifications
          </h4>
          {plan.verification_suggestions.map((suggestion, idx) => (
            <div
              key={idx}
              className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-md"
            >
              <div className="text-sm text-emerald-400">
                {suggestion.description}
              </div>
              <code className="text-xs text-emerald-500/70 font-mono mt-1 block">
                {suggestion.condition}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
