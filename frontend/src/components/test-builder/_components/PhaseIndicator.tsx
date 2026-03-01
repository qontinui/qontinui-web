"use client";

import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrchestratorPhase } from "../_types/orchestrator-types";
import { PHASES } from "../orchestrator-utils";

export function PhaseIndicator({
  currentPhase,
}: {
  currentPhase: OrchestratorPhase;
}) {
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, idx) => {
        const isComplete = idx < currentIndex;
        const isCurrent = idx === currentIndex;

        return (
          <div key={p.key} className="flex items-center">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                isComplete &&
                  "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
                isCurrent &&
                  "bg-purple-500/10 text-purple-400 border border-purple-500/30",
                !isComplete &&
                  !isCurrent &&
                  "bg-surface-raised/50 text-text-muted border border-border-subtle/30"
              )}
            >
              {isComplete ? (
                <Check className="size-3" />
              ) : (
                <span className="size-4 flex items-center justify-center rounded-full bg-current/10 text-[10px]">
                  {p.number}
                </span>
              )}
              {p.label}
            </div>
            {idx < PHASES.length - 1 && (
              <ChevronRight className="size-3.5 text-text-muted/40 mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}
