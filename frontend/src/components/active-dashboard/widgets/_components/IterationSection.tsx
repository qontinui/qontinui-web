"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  IterationGroup,
  WorkflowPhase,
} from "../execution-timeline-types";
import { PHASE_CONFIG } from "../execution-timeline-types";
import { StepRow } from "./StepRow";

export function IterationSection({
  iterationGroup,
  phase,
  defaultExpanded = true,
}: {
  iterationGroup: IterationGroup;
  phase: WorkflowPhase;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = PHASE_CONFIG[phase];
  const hasRunningStep = iterationGroup.steps.some(
    (s) => s.status === "running"
  );

  return (
    <div className="border-l border-border-subtle/30 ml-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-white/[0.02]",
          iterationGroup.isActive &&
            cn(config.bgColor, "border-l-2", config.borderColor)
        )}
      >
        {expanded ? (
          <ChevronDown className="size-3 text-text-muted" />
        ) : (
          <ChevronRight className="size-3 text-text-muted" />
        )}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 gap-1",
            iterationGroup.isActive
              ? cn(config.textColor, config.borderColor)
              : "text-text-muted border-border-subtle/50"
          )}
        >
          <RotateCcw className="size-2.5" />
          Iteration {iterationGroup.iteration}
        </Badge>
        {hasRunningStep && (
          <Loader2 className={cn("size-3 animate-spin", config.textColor)} />
        )}
        <span className="text-[10px] text-text-muted ml-auto">
          {iterationGroup.stats.completed}/{iterationGroup.stats.total}
        </span>
        {iterationGroup.stats.successful > 0 && (
          <span className="text-[10px] text-green-400">
            {iterationGroup.stats.successful}{" "}
            {phase === "agentic" ? "done" : "passed"}
          </span>
        )}
        {iterationGroup.stats.failed > 0 && (
          <span className="text-[10px] text-red-400">
            {iterationGroup.stats.failed} failed
          </span>
        )}
      </button>
      {expanded && (
        <div className="bg-white/[0.01]">
          {iterationGroup.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
