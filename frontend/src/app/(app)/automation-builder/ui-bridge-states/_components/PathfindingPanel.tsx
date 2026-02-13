"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Route, ArrowRight, Loader2 } from "lucide-react";
import type { SavedStateWithDetails, PathfindingResult } from "../_types";

interface PathfindingPanelProps {
  states: SavedStateWithDetails[];
  result: PathfindingResult | null;
  isLoading: boolean;
  onFindPath: (fromStates: string[], targetStates: string[]) => void;
  onClear: () => void;
}

export function PathfindingPanel({
  states,
  result,
  isLoading,
  onFindPath,
  onClear,
}: PathfindingPanelProps) {
  const [fromStates, setFromStates] = useState<string[]>([]);
  const [targetStates, setTargetStates] = useState<string[]>([]);

  const toggleFrom = (stateId: string) => {
    setFromStates((prev) =>
      prev.includes(stateId)
        ? prev.filter((s) => s !== stateId)
        : [...prev, stateId]
    );
  };

  const toggleTarget = (stateId: string) => {
    setTargetStates((prev) =>
      prev.includes(stateId)
        ? prev.filter((s) => s !== stateId)
        : [...prev, stateId]
    );
  };

  const handleFind = useCallback(() => {
    if (fromStates.length > 0 && targetStates.length > 0) {
      onFindPath(fromStates, targetStates);
    }
  }, [fromStates, targetStates, onFindPath]);

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Route className="size-5 text-brand-primary" />
        <h2 className="text-lg font-semibold text-text-primary">Pathfinding</h2>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* From States */}
        <div>
          <label className="text-sm font-medium text-text-primary mb-2 block">
            From States (currently active)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {states.map((s) => (
              <button
                key={s.state_id}
                onClick={() => toggleFrom(s.state_id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  fromStates.includes(s.state_id)
                    ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300"
                    : "bg-surface-secondary border-border-primary text-text-muted hover:border-blue-300"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Target States */}
        <div>
          <label className="text-sm font-medium text-text-primary mb-2 block">
            Target States (to reach)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {states.map((s) => (
              <button
                key={s.state_id}
                onClick={() => toggleTarget(s.state_id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  targetStates.includes(s.state_id)
                    ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300"
                    : "bg-surface-secondary border-border-primary text-text-muted hover:border-green-300"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleFind}
          disabled={isLoading || fromStates.length === 0 || targetStates.length === 0}
        >
          {isLoading ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <Route className="size-4 mr-1.5" />
          )}
          Find Path
        </Button>
        {result && (
          <Button variant="outline" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-lg border border-border-primary bg-surface-secondary p-4">
          {result.found ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-600">Path found</span>
                <span className="text-xs text-text-muted">
                  Total cost: {result.total_cost.toFixed(1)}
                </span>
              </div>
              <div className="space-y-2">
                {result.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-xs font-mono bg-surface-primary px-2 py-0.5 rounded border border-border-primary">
                      {step.from_states.join(", ")}
                    </span>
                    <ArrowRight className="size-3 text-text-muted shrink-0" />
                    <span className="text-xs font-medium text-brand-primary">
                      {step.transition_name}
                    </span>
                    <ArrowRight className="size-3 text-text-muted shrink-0" />
                    <span className="text-xs font-mono bg-surface-primary px-2 py-0.5 rounded border border-border-primary">
                      {step.activate_states.join(", ")}
                    </span>
                    <span className="text-[10px] text-text-muted ml-auto">
                      cost: {step.path_cost}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-500">
              {result.error || "No path found between the selected states."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
