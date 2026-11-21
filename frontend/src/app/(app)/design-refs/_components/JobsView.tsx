"use client";

/**
 * The Jobs view — the queue and its progress, failures with the worker's
 * reason, and retry (operator-only on the backend; a refusal is rendered, not
 * hidden). Discovery proposals (`proposed`) are approved or rejected here too.
 */

import { useMemo, useState } from "react";
import {
  BackendErrorMessage,
  FilterTabs,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import type { CaptureJob, CaptureJobState } from "@/lib/api/design-refs";
import {
  CAPTURE_JOBS_PAGE_LIMIT,
  moveCaptureJob,
  retryCaptureJob,
} from "@/lib/api/design-refs";
import {
  JOB_PALETTE,
  countByState,
  isTruncatedPage,
  jobStatus,
  tierReading,
  truncatedNote,
} from "../_lib/jobStatus";

type Filter = "all" | CaptureJobState;

export interface JobsViewProps {
  jobs: readonly CaptureJob[] | null;
  /** The last read failed (the jobs, if any, are from an earlier one). */
  readFailed: boolean;
  /** Re-read the queue now. */
  onChanged: () => void;
  /** The page size `jobs` was read with; a full page means counts are a floor. */
  limit?: number;
}

export function JobsView({
  jobs,
  readFailed,
  onChanged,
  limit = CAPTURE_JOBS_PAGE_LIMIT,
}: JobsViewProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => (jobs ? countByState(jobs) : null), [jobs]);
  const truncated = isTruncatedPage(jobs, limit);
  const shown = useMemo(
    () => (jobs ?? []).filter((j) => filter === "all" || j.state === filter),
    [jobs, filter]
  );

  async function act(job: CaptureJob, run: () => Promise<unknown>) {
    setBusyId(job.id);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  const tab = (id: CaptureJobState, label: string) => ({
    id,
    label,
    count: counts ? counts[id] : null,
    countIsFloor: truncated,
    attention:
      (id === "failed" || id === "proposed") && (counts?.[id] ?? 0) > 0,
  });

  return (
    <div
      className="space-y-3"
      data-testid="design-refs-jobs"
      data-ui-bridge-id="design-refs-jobs"
    >
      <FilterTabs<Filter>
        tabs={[
          {
            id: "all",
            label: "All",
            count: jobs ? jobs.length : null,
            countIsFloor: truncated,
          },
          tab("proposed", "To approve"),
          tab("queued", "Queued"),
          tab("running", "Capturing"),
          tab("failed", "Failed"),
          tab("done", "Captured"),
          tab("rejected", "Rejected"),
          tab("cancelled", "Cancelled"),
        ]}
        active={filter}
        onChange={setFilter}
        testIdPrefix="design-refs-jobs-filter"
      />

      {truncated && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="design-refs-jobs-truncated"
        >
          {truncatedNote(limit)}
        </p>
      )}

      {error !== null && (
        <div
          role="alert"
          className="text-sm text-red-300"
          data-testid="design-refs-jobs-error"
        >
          <BackendErrorMessage error={error} />
        </div>
      )}

      <RecordList
        items={shown}
        itemKey={(j) => j.id}
        loaded={jobs !== null || readFailed}
        expandedKey={expandedKey}
        onExpandedKeyChange={setExpandedKey}
        empty={
          jobs === null ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="design-refs-jobs-unknown"
            >
              The queue could not be read, so whether it holds jobs is unknown —
              not none.
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="design-refs-jobs-empty"
            >
              {truncated
                ? `No jobs${filter === "all" ? "" : " in this state"} among the newest ${limit}; older jobs were not read.`
                : `No jobs${filter === "all" ? "" : " in this state"}. Add URLs on the Add tab.`}
            </p>
          )
        }
        renderRow={(job, ctx) => {
          const status = jobStatus(job);
          const tier = tierReading(job);
          const busy = busyId === job.id;
          return (
            <RecordRow
              data-testid="design-refs-job-row"
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              attention={status.attention}
              identity={
                <span className="font-mono text-[11px]">{job.domain}</span>
              }
              label={
                <span title={job.url}>
                  {job.url}
                  <span className="text-muted-foreground">
                    {" "}
                    · {job.scope_kind}
                    {job.crawl_depth ? ` depth ${job.crawl_depth}` : ""}
                    {" · "}
                    {job.browser === "attached" ? "my Chrome" : "launched"}
                  </span>
                </span>
              }
              status={
                <span className="inline-flex items-center gap-1.5">
                  <span
                    data-testid="design-refs-job-status"
                    data-status={status.kind}
                  >
                    <StatusBadge status={status} palette={JOB_PALETTE} />
                  </span>
                  <span
                    className="text-[11px] text-muted-foreground"
                    data-testid="design-refs-job-tier"
                    data-tier={tier.kind}
                    title={tier.reason}
                  >
                    tier: {tier.label}
                  </span>
                </span>
              }
              reason={status.reason}
              reasonTestId="design-refs-job-reason"
              time={<RowTime at={job.updated_at} verb="Updated" />}
            >
              <RecordDetail
                data-testid="design-refs-job-detail"
                why={
                  <p
                    className="text-[13px] m-0"
                    data-testid="design-refs-job-tier-reason"
                  >
                    Tier {tier.label}: {tier.reason}
                  </p>
                }
                problems={
                  job.state === "failed" ? (
                    <p
                      className="text-[13px] m-0"
                      data-testid="design-refs-job-error"
                    >
                      {job.error ?? "The worker gave no reason."}
                    </p>
                  ) : undefined
                }
                actions={
                  <span className="inline-flex gap-2">
                    {job.state === "failed" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            act(job, () => retryCaptureJob(job.id))
                          }
                          data-testid="design-refs-job-retry"
                        >
                          Retry
                        </Button>
                        {job.browser !== "attached" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              act(job, () =>
                                retryCaptureJob(job.id, "attached")
                              )
                            }
                            data-testid="design-refs-job-retry-attached"
                            title="Re-queue it for capture through your own Chrome."
                          >
                            Retry in my Chrome
                          </Button>
                        )}
                      </>
                    )}
                    {job.state === "proposed" && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(job, () => moveCaptureJob(job.id, "queued"))
                          }
                          data-testid="design-refs-job-approve"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            act(job, () => moveCaptureJob(job.id, "rejected"))
                          }
                          data-testid="design-refs-job-reject"
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {(job.state === "queued" || job.state === "running") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          act(job, () => moveCaptureJob(job.id, "cancelled"))
                        }
                        data-testid="design-refs-job-cancel"
                      >
                        Cancel
                      </Button>
                    )}
                  </span>
                }
                raw={
                  <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
                    job: {job.id} · source: {job.source}
                    {job.submitter_id
                      ? ` · by ${job.submitter_kind} ${job.submitter_id}`
                      : ""}
                  </p>
                }
              />
            </RecordRow>
          );
        }}
      />
    </div>
  );
}
