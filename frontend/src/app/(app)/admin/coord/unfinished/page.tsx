"use client";

/**
 * /admin/coord/unfinished — closed sessions whose work was never declared
 * finished, fleet-wide, with per-row Resume / Dismiss, the sweep's last
 * verdict, and the tenant's automatic-resume switch.
 *
 * Plan `2026-10-06-closed-sessions-whose-work-is-unfinished-are-found-fleet-wide-and-resumed`
 * Phase 7. Reads coord's `GET /coord/sessions/unfinished` through the
 * operations proxy. Honesty: `state: "unknown"` renders UNKNOWN, never an
 * empty list; a failed re-read over a loaded list is stale, not empty.
 */

import { HealthStrip, RecordList, RefreshButton } from "@/components/console";
import { ResumeUnfinishedPanel } from "./_components/ResumeUnfinishedPanel";
import { UnfinishedRow } from "./_components/UnfinishedRow";
import { useUnfinishedSessions } from "./_hooks/useUnfinishedSessions";
import { useResumeUnfinishedPolicy } from "./_hooks/useResumeUnfinishedPolicy";
import { unknownDetailText, unknownReasonText } from "./_lib/unfinished";

export default function UnfinishedSessionsPage() {
  const { view, loading, error, busyId, reload, dismiss, resume } =
    useUnfinishedSessions();
  // Write actions are gated on the same admin read the toggle uses.
  const policyState = useResumeUnfinishedPolicy();
  const { policy } = policyState;
  const canAct = policy?.can_edit === true;

  const loaded = view !== null;
  const unknown = view?.state === "unknown";
  const rows = view?.state === "ok" ? (view.sessions ?? []) : [];
  const readFailed = error !== null;
  const unknownDetail = unknown && view ? unknownDetailText(view) : null;

  let level: "green" | "amber" | "red" = "green";
  let headline = "Reading unfinished sessions…";
  let detail: string | undefined;
  if (unknown && view) {
    level = "amber";
    headline = "Unfinished sessions: UNKNOWN";
    detail = `Could not be read — ${unknownReasonText(view)}. This is not "none".`;
  } else if (loaded && readFailed) {
    level = "amber";
    headline = `${rows.length} unfinished (stale)`;
    detail = "The last refresh failed; this is the previous read.";
  } else if (!loaded && readFailed) {
    level = "amber";
    headline = "Unfinished sessions: UNKNOWN";
    detail = "The read failed, so whether anything is unfinished is unknown.";
  } else if (loaded) {
    level = rows.length > 0 ? "amber" : "green";
    headline =
      rows.length === 0
        ? "No unfinished sessions"
        : `${rows.length} unfinished session${rows.length === 1 ? "" : "s"}`;
    if (view?.truncated) detail = "The list is truncated by coord's limit.";
  }

  return (
    <div className="space-y-4 p-3 sm:p-6" data-testid="unfinished-page">
      <HealthStrip
        level={level}
        headline={headline}
        detail={detail}
        data-testid="unfinished-health"
      />
      <ResumeUnfinishedPanel state={policyState} />
      <div className="flex items-center gap-2">
        <RefreshButton
          onRefresh={reload}
          label="Refresh unfinished sessions"
          title="Re-reads the unfinished sessions from coord now"
          data-testid="unfinished-refresh"
        />
        {loading && (
          <span className="text-xs text-muted-foreground">Reading…</span>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive" data-testid="unfinished-error">
          Failed to load: {error}
        </p>
      )}
      {unknown && view ? (
        <p
          className="text-sm italic text-muted-foreground"
          data-testid="unfinished-unknown"
        >
          UNKNOWN — {unknownReasonText(view)}. Whether any session is unfinished
          is not known.
          {unknownDetail && (
            <span
              className="mt-1 block break-all font-mono text-[11px] not-italic"
              data-testid="unfinished-unknown-detail"
            >
              coord: {unknownDetail}
            </span>
          )}
        </p>
      ) : (
        <RecordList
          items={rows}
          itemKey={(r) => r.claude_session_id}
          loaded={loaded || readFailed}
          skeletonRows={4}
          empty={
            readFailed && !loaded ? (
              <p
                className="text-sm italic text-muted-foreground"
                data-testid="unfinished-read-failed"
              >
                Could not read unfinished sessions — unknown, not none.
              </p>
            ) : (
              <p
                className="text-sm italic text-muted-foreground"
                data-testid="unfinished-empty"
              >
                No closed session is waiting on a finish mark.
              </p>
            )
          }
          renderRow={(row, ctx) => (
            <UnfinishedRow
              row={row}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              busy={busyId === row.claude_session_id}
              canAct={canAct}
              onResume={resume}
              onDismiss={dismiss}
            />
          )}
        />
      )}
    </div>
  );
}
