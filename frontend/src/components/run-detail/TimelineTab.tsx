"use client";

/**
 * TimelineTab - Staged workflow timeline (matches runner's StagedTimeline)
 *
 * Displays workflow steps grouped by phase (setup, verification, agentic, completion)
 * with collapsible stage sections, status icons, durations, iteration badges,
 * progress bars, and placeholder stages for phases that never ran.
 *
 * Uses the /checkpoints endpoint to get step-level data with phase/iteration grouping.
 * Falls back to flat events if no checkpoints are available.
 */

import { useMemo } from "react";
import {
  useTaskRunCheckpoints,
  useTaskRunEvents,
  type TaskRunEvent,
} from "@/lib/runner-api";
import { Clock, RefreshCw } from "lucide-react";
import { buildStagesFromCheckpoints } from "./_utils/timeline-utils";
import { StageSection } from "./_components/StageSection";
import { FlatEventTimeline } from "./_components/FlatEventTimeline";

export function TimelineTab({ runId }: { runId: string }) {
  const checkpointsQuery = useTaskRunCheckpoints(runId);
  const eventsQuery = useTaskRunEvents(runId);

  const isLoading = checkpointsQuery.isLoading && eventsQuery.isLoading;
  const error = checkpointsQuery.error && eventsQuery.error;

  const checkpoints = useMemo(
    () => checkpointsQuery.data ?? [],
    [checkpointsQuery.data]
  );
  const events = eventsQuery.data ?? [];

  const stages = useMemo(
    () => buildStagesFromCheckpoints(checkpoints),
    [checkpoints]
  );

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading timeline...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading timeline data
      </div>
    );
  }

  if (stages.length > 0) {
    return (
      <div className="space-y-3">
        {stages.map((stage, index) => (
          <StageSection
            key={`${stage.phase}-${stage.iteration ?? index}`}
            stage={stage}
          />
        ))}
      </div>
    );
  }

  if (events.length > 0) {
    return <FlatEventTimeline events={events as TaskRunEvent[]} />;
  }

  return (
    <div className="text-center py-12 text-text-muted">
      <Clock className="size-12 mx-auto mb-4 opacity-50" />
      <p>No timeline data for this run.</p>
      <p className="text-sm mt-1">
        Steps will appear here once the workflow starts executing.
      </p>
    </div>
  );
}
