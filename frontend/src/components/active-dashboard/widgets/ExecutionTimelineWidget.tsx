"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Clock, RefreshCw } from "lucide-react";
import { PHASE_CONFIG } from "./execution-timeline-types";
import { useExecutionTimeline } from "./_hooks/useExecutionTimeline";
import { PhaseSection } from "./_components/PhaseSection";
import { TimelineStatsBar } from "./_components/TimelineStatsBar";

export function ExecutionTimelineWidget({ runId: _runId }: { runId: string }) {
  const {
    response,
    isLoading,
    currentPhase,
    phaseGroups,
    stats,
    stepStats,
    expandedIterations,
  } = useExecutionTimeline();

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="size-4 text-blue-400" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col overflow-hidden">
      <CardHeader className="py-2.5 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="size-4 text-blue-400" />
          Timeline
          {response?.workflow_name && (
            <span className="text-xs font-normal text-text-muted truncate">
              {response.workflow_name}
            </span>
          )}
          {currentPhase && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] ml-auto",
                PHASE_CONFIG[currentPhase].textColor,
                PHASE_CONFIG[currentPhase].borderColor
              )}
            >
              {PHASE_CONFIG[currentPhase].label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      {/* Stats Bar */}
      <TimelineStatsBar
        stats={stats}
        totalSteps={stepStats.total}
        completedSteps={stepStats.completed}
        failedSteps={stepStats.failed}
      />

      {/* Phase Groups */}
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          <div className="flex flex-col">
            {phaseGroups.map((group) => (
              <PhaseSection
                key={`${group.stageIndex}:${group.phase}`}
                group={group}
                defaultExpanded={group.isActive || group.steps.length < 10}
                expandedIterations={expandedIterations}
              />
            ))}
            {phaseGroups.length === 0 && (
              <div
                data-ui-id="timeline-empty-state"
                className="flex flex-col items-center justify-center h-32 text-text-muted"
              >
                <Clock className="size-8 mb-2 opacity-50" />
                <span className="text-sm">No active workflow steps yet</span>
                <span className="text-xs mt-1 opacity-70">
                  Waiting for execution to begin...
                </span>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
