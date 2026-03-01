"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PhaseGroup } from "../execution-timeline-types";
import { PHASE_CONFIG } from "../execution-timeline-types";
import { StepRow } from "./StepRow";
import { IterationSection } from "./IterationSection";

export function PhaseSection({
  group,
  defaultExpanded = true,
  expandedIterations,
}: {
  group: PhaseGroup;
  defaultExpanded?: boolean;
  expandedIterations: Set<string>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || group.isActive);
  const config = PHASE_CONFIG[group.phase];
  const showFlatList =
    !group.hasIterations || group.iterationGroups.length === 0;
  const hasRunningStep = group.steps.some((s) => s.status === "running");

  return (
    <div className="border-b border-border-subtle/30 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03]",
          group.isActive && cn(config.bgColor, config.borderColor, "border-l-2")
        )}
      >
        {expanded ? (
          <ChevronDown className="size-4 text-text-muted" />
        ) : (
          <ChevronRight className="size-4 text-text-muted" />
        )}
        <Badge
          variant="outline"
          className={cn(
            "px-2 py-0.5 text-xs font-medium",
            group.isActive
              ? cn(config.bgColor, config.textColor, config.borderColor)
              : group.isComplete
                ? "bg-green-500/10 text-green-400 border-green-500/30"
                : "bg-white/5 text-text-muted border-border-subtle/50"
          )}
        >
          {group.displayLabel}
        </Badge>
        {hasRunningStep && (
          <Loader2 className={cn("size-3.5 animate-spin", config.textColor)} />
        )}
        {group.hasIterations && group.iterationGroups.length > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-5 gap-1 text-text-muted border-border-subtle/50"
          >
            <RotateCcw className="size-2.5" />
            {group.iterationGroups.length} iter
          </Badge>
        )}
        {!group.hasIterations && (
          <span className="text-xs text-text-muted ml-auto">
            {group.stats.completed}/{group.stats.total} steps
          </span>
        )}
        {!group.hasIterations && group.stats.successful > 0 && (
          <span className="text-[10px] text-green-400">
            {group.stats.successful}{" "}
            {group.phase === "agentic" ? "done" : "passed"}
          </span>
        )}
        {!group.hasIterations && group.stats.failed > 0 && (
          <span className="text-[10px] text-red-400">
            {group.stats.failed} failed
          </span>
        )}
      </button>
      {expanded && (
        <div className="bg-white/[0.01]">
          {showFlatList ? (
            <>
              {group.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
              {group.steps.length === 0 && (
                <div className="px-4 py-3 text-xs text-text-muted text-center">
                  No steps in this phase yet
                </div>
              )}
            </>
          ) : (
            <>
              {group.iterationGroups.map((iterGroup) => {
                const iterKey = `${group.phase}-${iterGroup.iteration}`;
                return (
                  <IterationSection
                    key={iterKey}
                    iterationGroup={iterGroup}
                    phase={group.phase}
                    defaultExpanded={expandedIterations.has(iterKey)}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
