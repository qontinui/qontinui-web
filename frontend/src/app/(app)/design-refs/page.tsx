"use client";

/**
 * /design-refs — intake for the design reference library: Add (one URL or a
 * pasted list) and Jobs (the capture queue and its progress).
 *
 * Plan `2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query`
 * Phase 1b-i. A product route for every tenant, NOT under `admin/coord/`:
 * private records belong to each tenant. Composed from `components/console/`
 * per `frontend/docs/console-ui-style-guide.md`: no page title (R9), the strip
 * first (R1), one line per job (R2) whose detail expands in place (R5), live
 * counts on the tabs (R6).
 *
 * One poll feeds the strip, the Jobs tab and the Add tab's "Added" list, so
 * the worker's derived tier shows up on all of them without extra requests. A
 * failed read keeps the last good queue and says so; it never reads as an
 * empty queue.
 */

import { useCallback, useMemo, useState } from "react";
import { FilterTabs, HealthStrip, RefreshButton } from "@/components/console";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  CAPTURE_JOBS_PAGE_LIMIT,
  fetchCaptureJobs,
  type CaptureJob,
} from "@/lib/api/design-refs";
import { AddView } from "./_components/AddView";
import { JobsView } from "./_components/JobsView";
import {
  DESIGN_REFS_POLL_MS,
  countByState,
  deriveJobsHealth,
  isTruncatedPage,
} from "./_lib/jobStatus";

type View = "add" | "jobs";

export default function DesignRefsPage() {
  const [view, setView] = useState<View>("add");
  const [jobs, setJobs] = useState<CaptureJob[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const rows = await fetchCaptureJobs();
      if (!isCurrent()) return;
      setJobs(rows);
      setReadFailed(false);
    } catch {
      if (!isCurrent()) return;
      setReadFailed(true);
    }
  }, []);
  const { refresh } = useSingleFlightPoll(poll, DESIGN_REFS_POLL_MS);

  const health = useMemo(
    () => deriveJobsHealth(jobs, readFailed, CAPTURE_JOBS_PAGE_LIMIT),
    [jobs, readFailed]
  );
  const counts = useMemo(() => (jobs ? countByState(jobs) : null), [jobs]);
  const open = counts
    ? counts.queued + counts.running + counts.proposed + counts.failed
    : null;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="design-refs-page"
      data-ui-bridge-id="design-refs-page"
    >
      <HealthStrip
        data-testid="design-refs-health"
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs<View>
          tabs={[
            { id: "add", label: "Add" },
            {
              id: "jobs",
              label: "Jobs",
              count: open,
              countIsFloor: isTruncatedPage(jobs, CAPTURE_JOBS_PAGE_LIMIT),
            },
          ]}
          active={view}
          onChange={setView}
          testIdPrefix="design-refs-view"
        />
        <RefreshButton
          onRefresh={refresh}
          label="Refresh jobs"
          title={`Re-reads the capture queue now; the page also refreshes itself every ${DESIGN_REFS_POLL_MS / 1000} s`}
          data-testid="design-refs-refresh"
        />
      </div>

      {view === "add" ? (
        <AddView jobs={jobs ?? []} onSubmitted={() => void refresh()} />
      ) : (
        <JobsView
          jobs={jobs}
          readFailed={readFailed}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
