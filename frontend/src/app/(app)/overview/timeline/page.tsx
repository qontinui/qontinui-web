"use client";

/**
 * Project Overview — Timeline. The project's phases, milestones and decision
 * gates, DERIVED ONLY from coord (plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, D5).
 *
 * What it reads: `GET /api/v1/overview/schedule` and nothing else. There is no
 * estimate, no typed phase progress, no typed milestone and no entered value on
 * this page, and nothing here writes: a value that is wrong or missing is
 * corrected in coord, and shows here on the next read. Where coord cannot
 * answer, the figure reads "Not available since …" with the reason (D4).
 *
 * Loading, failure and "nothing recorded" are kept apart; none renders as an
 * empty chart.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import { useSchedule } from "../_hooks/useSchedule";
import { ScheduleSection } from "./_components/ScheduleSection";

function Loading({ uiBridgeId }: { uiBridgeId: string }) {
  return (
    <div className="space-y-3" aria-hidden data-ui-bridge-id={uiBridgeId}>
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
    </div>
  );
}

export default function TimelinePage() {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const schedule = useSchedule(projectId, hold);

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.timeline.error"
      />
    );
  }

  return (
    <div className="space-y-14" data-ui-bridge-id="overview.timeline">
      {schedule.loading && !schedule.data && (
        <Loading uiBridgeId="overview.schedule.loading" />
      )}
      {schedule.data && <ScheduleSection env={schedule.data} />}
      {schedule.error && (
        <LoadFailure
          what={
            schedule.data
              ? "the latest update of the schedule"
              : "the schedule from the project record"
          }
          message={schedule.error}
          uiBridgeId="overview.schedule.error"
          announce={false}
        />
      )}
    </div>
  );
}
