"use client";

/**
 * UnifiedStepCard - Displays execution steps from both real TreeEvents and mock testing
 *
 * This component provides a unified UI for displaying:
 * - Real execution events from qontinui-runner (TreeEvents)
 * - Mock/simulation steps from integration testing
 *
 * Uses the UnifiedExecutionStep type to normalize both formats.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import { getStepTypeLabel } from "@/lib/tree-event-adapter";

import { useStepExpansion } from "./_hooks/useStepExpansion";
import { StepIcon } from "./_components/StepIcon";
import { StatusBadge } from "./_components/StatusBadge";
import { QuickPreview } from "./_components/QuickPreview";
import { StepDetails } from "./_components/StepDetails";
import { formatDuration } from "./utils";

interface UnifiedStepCardProps {
  step: UnifiedExecutionStep;
  isExpanded?: boolean;
  onToggle?: () => void;
  isCurrent?: boolean;
  /** Map of state/element IDs to display names */
  nameMap?: Map<string, string>;
  /** Task run ID for progress tracking */
  taskRunId?: string;
  /** Enable real-time progress tracking for running steps */
  enableProgressTracking?: boolean;
}

export function UnifiedStepCard({
  step,
  isExpanded = false,
  onToggle,
  isCurrent = false,
  nameMap,
  taskRunId,
  enableProgressTracking = false,
}: UnifiedStepCardProps) {
  const { expanded, toggle } = useStepExpansion(isExpanded, onToggle);

  return (
    <Card
      className={`bg-surface-raised/50 border-border-subtle/50 transition-all ${
        isCurrent
          ? "ring-2 ring-brand-primary/50 shadow-lg shadow-brand-primary/10"
          : ""
      }`}
    >
      <Collapsible open={expanded} onOpenChange={toggle}>
        <CollapsibleTrigger asChild>
          <CardContent className="p-4 cursor-pointer hover:bg-surface-raised/20 transition-colors">
            <div className="flex items-start gap-3">
              {/* Step icon */}
              <div className="flex-shrink-0 mt-0.5">
                <StepIcon step={step} />
              </div>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs font-mono">
                      #{step.stepNumber}
                    </Badge>
                    <span className="text-sm font-medium text-white">
                      {step.name || getStepTypeLabel(step)}
                    </span>
                    <StatusBadge status={step.status} />
                    {isCurrent && (
                      <Badge className="bg-brand-primary/20 text-brand-primary border-brand-primary/30 text-xs">
                        Current
                      </Badge>
                    )}
                    {step.isRealExecution && (
                      <Badge
                        variant="outline"
                        className="text-xs border-green-500/30 text-green-400"
                      >
                        Live
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(step.durationMs)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-surface-raised/50"
                    >
                      {expanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Quick preview */}
                <div className="mt-2 text-xs text-text-muted">
                  <QuickPreview step={step} nameMap={nameMap} />
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-0 border-t border-border-subtle/50">
            <div className="pt-4">
              <StepDetails
                step={step}
                nameMap={nameMap}
                taskRunId={taskRunId}
                enableProgressTracking={enableProgressTracking}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default UnifiedStepCard;
