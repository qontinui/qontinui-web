"use client";

import { Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TimelineStep } from "../execution-timeline-types";
import { STEP_ICONS, STEP_COLORS } from "../execution-timeline-types";
import { formatDuration } from "../execution-timeline-utils";
import { StatusIcon } from "@/components/common/_components/StatusIcon";

export function StepRow({ step }: { step: TimelineStep }) {
  const Icon = STEP_ICONS[step.type];
  const colors = STEP_COLORS[step.type];
  const isActive = step.status === "running";

  return (
    <div
      className={cn(
        "border-l-2 transition-colors",
        isActive
          ? "border-blue-500 bg-blue-500/5"
          : "border-transparent hover:bg-white/[0.02]"
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <StatusIcon status={step.status} variant="compact" />
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] shrink-0 font-mono gap-1 px-1.5 py-0 h-5",
            colors.bg,
            colors.text,
            colors.border
          )}
        >
          <Icon className="size-2.5" />
          {step.type}
        </Badge>
        <span className="flex-1 text-xs truncate text-text-primary">
          {step.name}
        </span>
        {step.durationMs !== undefined && (
          <span className="text-[10px] text-text-muted font-mono shrink-0">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {isActive && (
          <Loader2 className="size-3 text-blue-400 animate-spin shrink-0" />
        )}
        {step.error && (
          <span title={step.error}>
            <AlertCircle className="size-3 text-red-500 shrink-0" />
          </span>
        )}
      </div>
    </div>
  );
}
