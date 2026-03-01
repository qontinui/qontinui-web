"use client";

import {
  ChevronRight,
  Settings,
  Send,
  CheckCircle,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestStepsPreviewProps } from "../_types/orchestrator-types";

export function TestStepsPreview({ steps }: TestStepsPreviewProps) {
  if (!steps || steps.length === 0) return null;

  const stepTypeConfig: Record<
    string,
    { bg: string; iconColor: string; badgeColor: string; Icon: typeof Settings }
  > = {
    setup: {
      bg: "bg-surface-canvas/30",
      iconColor: "text-text-muted",
      badgeColor: "bg-surface-raised/50 text-text-muted",
      Icon: Settings,
    },
    request: {
      bg: "bg-blue-500/5",
      iconColor: "text-blue-400",
      badgeColor: "bg-blue-500/10 text-blue-400",
      Icon: Send,
    },
    assertion: {
      bg: "bg-emerald-500/5",
      iconColor: "text-emerald-400",
      badgeColor: "bg-emerald-500/10 text-emerald-400",
      Icon: CheckCircle,
    },
    cleanup: {
      bg: "bg-orange-500/5",
      iconColor: "text-orange-400",
      badgeColor: "bg-orange-500/10 text-orange-400",
      Icon: Trash2,
    },
  };

  const defaultConfig = stepTypeConfig["setup"]!;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-1.5">
        <ChevronRight className="size-3.5" />
        Test Steps Preview
      </h4>

      <div className="border border-border-subtle/40 rounded-md overflow-hidden">
        {steps.map((step, idx) => {
          const config = stepTypeConfig[step.step_type] ?? defaultConfig;
          const StepIcon = config.Icon;

          return (
            <div
              key={idx}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5",
                idx > 0 && "border-t border-border-subtle/20",
                config.bg
              )}
            >
              <div className="flex items-center gap-2 shrink-0">
                <span className="size-5 rounded-full bg-surface-raised/50 text-text-muted text-[10px] font-medium flex items-center justify-center">
                  {step.step_number}
                </span>
                <StepIcon className={cn("size-3.5", config.iconColor)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[10px] rounded",
                      config.badgeColor
                    )}
                  >
                    {step.step_type}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {step.action}
                  </span>
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  Expected: {step.expected}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary counts */}
      <div className="flex items-center gap-3 text-[10px] text-text-muted px-1">
        {(["setup", "request", "assertion", "cleanup"] as const).map((type) => {
          const count = steps.filter((s) => s.step_type === type).length;
          if (count === 0) return null;
          return (
            <span key={type}>
              {count} {type}
              {count !== 1 && type !== "cleanup" ? "s" : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
