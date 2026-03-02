"use client";

import { useState } from "react";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import {
  PHASE_COLORS,
  PHASE_ICONS,
  type StageData,
} from "../_types/timeline-types";
import { formatDuration } from "../_utils/timeline-utils";
import { StatusIcon } from "@/components/common/_components/StatusIcon";
import { StepItem } from "./StepItem";

export function StageSection({ stage }: { stage: StageData }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = PHASE_ICONS[stage.phase] || Activity;
  const colors = PHASE_COLORS[stage.phase] || PHASE_COLORS.setup;

  return (
    <div className="rounded-lg border border-border-subtle/50 bg-surface-raised/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-canvas/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded ${colors.bg}`}>
            <Icon className={`size-4 ${colors.text}`} />
          </div>
          <span className="font-medium text-text-primary">
            {stage.displayName}
          </span>
          <StatusIcon status={stage.status} />
          {stage.iteration != null && (
            <span className="text-xs text-text-muted bg-surface-canvas/50 px-1.5 py-0.5 rounded">
              Iteration {stage.iteration}
            </span>
          )}
          <span className="text-sm text-text-muted">
            ({stage.steps.length} {stage.steps.length === 1 ? "step" : "steps"})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {stage.durationMs != null && (
            <span className="text-sm text-text-muted">
              {formatDuration(stage.durationMs)}
            </span>
          )}
          {stage.steps.length > 0 &&
            (expanded ? (
              <ChevronDown className="size-4 text-text-muted" />
            ) : (
              <ChevronRight className="size-4 text-text-muted" />
            ))}
        </div>
      </button>

      {expanded && stage.steps.length > 0 && (
        <div className="border-t border-border-subtle/50 p-2 space-y-1">
          {stage.steps.map((step, i) => (
            <StepItem key={`${step.id}-${i}`} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
