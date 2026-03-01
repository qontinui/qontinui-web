"use client";

import { useMemo } from "react";
import { Check, Play, Variable, Link2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PlanVisualizationProps,
  VariableMappingInfo,
} from "../_types/orchestrator-types";

function HighlightVariables({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.match(/^\{\{[^}]+\}\}$/)) {
          return (
            <span key={idx} className="text-purple-400 font-semibold">
              {part}
            </span>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </>
  );
}

export function PlanVisualization({
  plan,
  currentStepIndex = -1,
  isExecuting = false,
}: PlanVisualizationProps) {
  const variablesByStep = useMemo(() => {
    const map = new Map<number, VariableMappingInfo[]>();
    for (const mapping of plan.variable_mappings) {
      const existing = map.get(mapping.source_step) || [];
      existing.push(mapping);
      map.set(mapping.source_step, existing);
    }
    return map;
  }, [plan]);

  return (
    <div className="space-y-2">
      {plan.steps.map((step, idx) => {
        const isComplete = idx < currentStepIndex;
        const isCurrent = idx === currentStepIndex && isExecuting;
        const variables = variablesByStep.get(idx) || [];

        return (
          <div key={step.step_index} className="relative">
            {/* Connection line */}
            {idx < plan.steps.length - 1 && (
              <div className="absolute left-5 top-full w-0.5 h-2 bg-border-subtle/30" />
            )}

            {/* Step card */}
            <div
              className={cn(
                "flex items-start gap-3 p-3 rounded-md border transition-all",
                isComplete && "bg-emerald-500/5 border-emerald-500/20",
                isCurrent &&
                  "bg-blue-500/5 border-blue-500/30 shadow-sm shadow-blue-500/5",
                !isComplete &&
                  !isCurrent &&
                  "bg-surface-canvas/30 border-border-subtle/40"
              )}
            >
              {/* Step indicator circle */}
              <div
                className={cn(
                  "size-8 rounded-full flex items-center justify-center shrink-0",
                  isComplete && "bg-emerald-500/20",
                  isCurrent && "bg-blue-500/20 animate-pulse",
                  !isComplete && !isCurrent && "bg-surface-raised/50"
                )}
              >
                {isComplete ? (
                  <Check className="size-4 text-emerald-400" />
                ) : isCurrent ? (
                  <Play className="size-4 text-blue-400" />
                ) : (
                  <span className="text-xs font-medium text-text-muted">
                    {idx + 1}
                  </span>
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {step.name}
                  </span>
                  {step.depends_on.length > 0 && (
                    <span className="text-[10px] text-text-muted">
                      (needs step {step.depends_on.map((d) => d + 1).join(", ")}
                      )
                    </span>
                  )}
                </div>

                <p className="text-xs text-text-muted mt-0.5">{step.purpose}</p>

                {/* URL template */}
                <div className="mt-2 flex items-center gap-2">
                  <code className="text-xs text-text-muted/80 truncate flex-1 font-mono">
                    <HighlightVariables text={step.url_template} />
                  </code>
                </div>

                {/* Extractions */}
                {step.extractions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {step.extractions.map((ext, extIdx) => (
                      <div
                        key={extIdx}
                        className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-[10px]"
                      >
                        <Variable className="size-2.5 text-purple-400" />
                        <span className="text-purple-300">
                          {ext.variable_name}
                        </span>
                        <span className="text-purple-500/60">&larr;</span>
                        <span className="text-purple-400/70 font-mono">
                          {ext.json_path}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Variable flow */}
                {variables.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-text-muted">
                    <Link2 className="size-2.5" />
                    <span>
                      Passes{" "}
                      <span className="text-purple-400">
                        {variables.map((v) => v.variable_name).join(", ")}
                      </span>{" "}
                      to step(s){" "}
                      {variables
                        .flatMap((v) => v.used_in_steps)
                        .map((s) => s + 1)
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Variable flow arrow between steps */}
            {variables.length > 0 && idx < plan.steps.length - 1 && (
              <div className="flex items-center justify-center py-0.5">
                <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/5 rounded text-[10px] text-purple-400">
                  <Variable className="size-2.5" />
                  {variables.map((v) => v.variable_name).join(", ")}
                  <ArrowRight className="size-2.5" />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
