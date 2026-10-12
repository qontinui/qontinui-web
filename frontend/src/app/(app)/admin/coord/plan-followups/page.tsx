"use client";

/**
 * /admin/coord/plan-followups — work a plan surfaced, by state.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c
 * made this the consumer for `GET /api/v1/plan-library/followups`, which had
 * none: a `git grep` for the route name across `frontend/**` on `origin/main`
 * matched only the two generated OpenAPI snapshots [policy:
 * `capability-ships-enabled`]. Plan
 * `2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down`
 * Phase 3 gave a follow-up a closure state and file anchors; this page is the
 * queue's only human surface, so it reads every state (`?state=`), shows what
 * each follow-up is about (`repo:path[:line]`), and carries the `dismissed`
 * state's only writer.
 *
 * ## Why this page is a list of notes and not a row-per-record table
 *
 * R2 says one record is one line, and this surface deliberately does not obey
 * it. The reason is the payload: `note` IS the follow-up. With no far-end
 * artifact there is nowhere else for the finding to live — the schema requires
 * it non-blank for exactly that reason — and before this route existed it was
 * prose in a plan body, unrecoverable from the data. A one-line row with a
 * `…` and a click would put the product back there, so every note is rendered
 * in full. `followupStatus.ts`'s module docstring is where that decision is
 * written down, and `page.test.tsx` — *"renders the note IN FULL, not
 * truncated to a headline"* — is what pins it.
 *
 * Nothing on this page is red. An unowned follow-up is a backlog item the
 * fleet deliberately deferred, not an incident; R3 reserves red for "someone
 * must act NOW", and spending it here is how an eye learns to skip red.
 *
 * ## Leaving the open view is not "nothing was surfaced"
 *
 * A follow-up leaves the open view two ways and neither deletes it. A CLAIMED
 * one becomes an ordinary two-ended provenance edge and stays on the
 * originating artifact's edge list; a RESOLVED one moves to its state —
 * `fixing` while a fix PR is open, then `fixed` once coord sees it land, or
 * `already_fixed` / `dismissed` — and is read under Fixing or Resolved. An
 * empty open view therefore means nothing is unowned and unresolved. The page
 * says so rather than letting the reader supply the other reading.
 *
 * ## Dismiss
 *
 * Closing a follow-up without a fix is an operator's call and it must say why:
 * the action posts `POST /api/v1/plan-library/edges/{id}/resolution`
 * `{"resolution": "dismissed", "resolution_note": <reason>}` and sends NOTHING
 * while the reason is blank — the store would refuse it, and a dismissal with
 * no reason is the unexplained closure the reason exists to prevent.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FilterTabs,
  HealthStrip,
  RefreshButton,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import {
  useGuardedPoll,
  type ReadGuard,
} from "@/components/admin/coord/useGuardedPoll";
import { useCursorPager } from "@/components/admin/coord/cursorPager";
import { httpClient } from "@/services/service-factory";
import {
  EXPECTED_ORDERING,
  FOLLOWUP_VIEWS,
  FOLLOWUP_VIEW_LABELS,
  daysInState,
  deriveFollowupHealth,
  describeFollowupWindow,
  formatAnchor,
  type FollowupView,
  type OpenFollowup,
  type OpenFollowupResponse,
} from "./followupStatus";

const ENDPOINT = "/api/v1/plan-library/followups";
const RESOLUTION_ENDPOINT = (edgeId: string) =>
  `/api/v1/plan-library/edges/${encodeURIComponent(edgeId)}/resolution`;
const POLL_INTERVAL_MS = 60_000;
/** The route's own default and ceiling: `Query(50, ge=1, le=200)`. */
const PAGE_SIZE = 50;

/** `owner/name#n` → its GitHub pull request, or `null` when it is not one. */
function prHref(citation: string): string | null {
  const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(
    citation
  );
  return match ? `https://github.com/${match[1]}/pull/${match[2]}` : null;
}

/** What the empty view says — per view, because "nothing open" and "nothing
 *  being fixed" are different findings. */
function emptyViewText(view: FollowupView): string {
  if (view === "fixing") {
    return "No follow-up is held by an open fix PR in this window.";
  }
  if (view === "resolved") {
    return "No follow-up has been resolved in this window.";
  }
  return "Nothing is waiting for an owner in this window. A claimed or resolved follow-up drops out of the open view without being deleted, so this is not “no plan surfaced any follow-up”.";
}

export default function CoordPlanFollowupsPage() {
  const pager = useCursorPager();
  const { cursor, start, reset: resetPager } = pager;
  const [view, setView] = useState<FollowupView>("open");
  const [data, setData] = useState<OpenFollowupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The OTHER views' totals, read beside the active one (`limit=1`). `null`
   *  is not-read / could-not-read, and renders `–` (R6). */
  const [counts, setCounts] = useState<Record<FollowupView, number | null>>({
    open: null,
    fixing: null,
    resolved: null,
  });

  /**
   * Guarded by `useGuardedPoll` — the two generation counters and the
   * in-flight lock, one spelling shared with `/admin/coord/plans`. The cursor
   * and the view are the question: a cursor is bound to the state it was
   * minted under, so a view change also resets the pager.
   */
  const fetchData = useCallback(
    async (guard: ReadGuard) => {
      const qs = new URLSearchParams();
      qs.set("state", view);
      // Keyset paging: the previous page's `next_cursor`, verbatim (the
      // route has no `offset`).
      if (cursor !== null) qs.set("cursor", cursor);
      qs.set("limit", String(PAGE_SIZE));
      // The active view's page first, then each other view's total — a
      // `limit=1` read's `total` is that whole view (R6: tabs carry live
      // counts). All settle together, so a failed read is never left
      // unobserved and one failed count never fails the page.
      const others = FOLLOWUP_VIEWS.filter((v) => v !== view);
      const [main, ...countResults] = await Promise.allSettled([
        httpClient.get<OpenFollowupResponse>(`${ENDPOINT}?${qs.toString()}`),
        ...others.map((v) =>
          httpClient.get<OpenFollowupResponse>(`${ENDPOINT}?state=${v}&limit=1`)
        ),
      ]);
      if (main.status === "rejected") {
        if (!guard.isCurrentQuestion()) return;
        const reason: unknown = main.reason;
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      if (!guard.isNewest()) return;
      setData(main.value);
      setError(null);
      setCounts((prev) => {
        const next = { ...prev };
        others.forEach((v, i) => {
          const result = countResults[i];
          next[v] =
            result?.status === "fulfilled" &&
            typeof result.value?.total === "number"
              ? result.value.total
              : null;
        });
        return next;
      });
    },
    [cursor, view]
  );

  // The cursor and the view are the question: rows already held answer the
  // previous one.
  const resetWindow = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  const { refresh } = useGuardedPoll({
    read: fetchData,
    intervalMs: POLL_INTERVAL_MS,
    onQuestionChange: resetWindow,
  });

  // ── Dismiss ────────────────────────────────────────────────────────────
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const changeView = useCallback(
    (next: FollowupView) => {
      if (next === view) return;
      resetPager();
      setView(next);
      // A reason typed for a row in the old view belongs to that row; it must
      // not reappear, pre-filled, when the view comes back.
      setDismissing(null);
      setReason("");
      setDismissError(null);
    },
    [view, resetPager]
  );

  const openDismiss = (edgeId: string) => {
    setDismissing(edgeId);
    setReason("");
    setDismissError(null);
  };
  const cancelDismiss = () => {
    setDismissing(null);
    setReason("");
    setDismissError(null);
  };
  const submitDismiss = async (edgeId: string) => {
    const text = reason.trim();
    // A blank reason sends NOTHING — the reason is the closure's record.
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await httpClient.post(RESOLUTION_ENDPOINT(edgeId), {
        resolution: "dismissed",
        resolution_note: text,
      });
      setDismissing(null);
      setReason("");
      setDismissError(null);
      await refresh();
    } catch (e) {
      setDismissError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const loaded = data !== null;
  const readFailed = error !== null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const window = useMemo(
    () => (data ? describeFollowupWindow(data, start) : null),
    [data, start]
  );
  const health = useMemo(
    () => deriveFollowupHealth(data, loaded, readFailed, start, view),
    [data, loaded, readFailed, start, view]
  );
  const tabs = FOLLOWUP_VIEWS.map((v) => ({
    id: v,
    label: FOLLOWUP_VIEW_LABELS[v],
    count: v === view ? (window?.total ?? null) : counts[v],
  }));

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-plan-followups-page"
    >
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-plan-followups-health"
      />

      <FilterTabs
        tabs={tabs}
        active={view}
        onChange={changeView}
        testIdPrefix="coord-followups-view"
      />

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          key={`${view}:${cursor ?? ""}`}
          onRefresh={refresh}
          label="Refresh follow-ups"
          title={`Re-reads the follow-ups now; they also refresh themselves every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-followups-refresh"
        />
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-followups-semantics"
        >
          A claimed or resolved follow-up drops out of the open view. Neither is
          deleted: a claimed one becomes an ordinary provenance edge on the plan
          that surfaced it, and a resolved one is under Fixing or Resolved.
          Candidates that carry the open ones along are at{" "}
          <Link
            href="/admin/coord/plan-candidates"
            className="underline"
            data-testid="coord-followups-candidates-link"
          >
            Plan Candidates
          </Link>
          .
        </p>
      </div>

      {window && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-followups-window"
        >
          Showing {window.shown} of{" "}
          {window.total !== null ? (
            window.total
          ) : (
            <span data-testid="coord-followups-total-unknown">
              an unknown total — the route served no count
            </span>
          )}{" "}
          {view} follow-ups
          {window.shown > 0 && (
            <>
              {" "}
              (rows {window.start + 1}–{window.start + window.shown})
            </>
          )}
          , page size {window.limit ?? "unstated"}, ordered{" "}
          <span className="font-mono" data-testid="coord-followups-ordering">
            {window.ordering ?? "unstated"}
          </span>
          .
          {window.orderingUnexpected && (
            <span data-testid="coord-followups-ordering-unexpected">
              {" "}
              That is not the{" "}
              <span className="font-mono">{EXPECTED_ORDERING}</span> this page
              expects, so nothing here warrants reading the first row as the
              oldest.
            </span>
          )}
        </p>
      )}

      {error && (
        <p
          className="text-sm text-destructive"
          data-testid="coord-followups-error"
        >
          Failed to load: {error}
        </p>
      )}

      {!loaded && !readFailed && (
        <p className="text-sm text-muted-foreground italic">
          Reading the follow-ups…
        </p>
      )}

      {readFailed && !loaded && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-followups-unknown"
        >
          Could not read the follow-ups — whether anything is in this view is
          unknown, not none.
        </p>
      )}

      {loaded && items.length === 0 && readFailed && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-followups-stale"
        >
          This window held no follow-up at the last good read — it has not
          refreshed since. Whether anything is in this view NOW is unknown.
        </p>
      )}

      {loaded && items.length === 0 && !readFailed && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-followups-empty"
        >
          {emptyViewText(view)}
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2" data-testid="coord-followups-list">
          {items.map((f) => (
            <FollowupRow
              key={f.edge_id}
              followup={f}
              dismissOpen={dismissing === f.edge_id}
              reason={reason}
              submitting={submitting}
              dismissError={dismissing === f.edge_id ? dismissError : null}
              onDismiss={() => openDismiss(f.edge_id)}
              onReasonChange={setReason}
              onConfirm={() => void submitDismiss(f.edge_id)}
              onCancel={cancelDismiss}
            />
          ))}
        </ul>
      )}

      <div
        className="flex items-center gap-2"
        data-testid="coord-followups-paging"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!pager.canPrev}
          onClick={pager.prev}
          data-testid="coord-followups-page-prev"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!(window?.hasMore ?? false)}
          onClick={() => {
            if (window?.nextCursor) pager.next(window.nextCursor, window.shown);
          }}
          data-testid="coord-followups-page-next"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function FollowupRow({
  followup: f,
  dismissOpen,
  reason,
  submitting,
  dismissError,
  onDismiss,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  followup: OpenFollowup;
  dismissOpen: boolean;
  reason: string;
  submitting: boolean;
  dismissError: string | null;
  onDismiss: () => void;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // A backend that predates closure states served only open rows.
  const state = f.state ?? "open";
  const anchors = f.anchors ?? [];
  const inState = daysInState(f);
  const pr = f.resolution_pr ?? null;
  const href = pr ? prHref(pr) : null;
  return (
    <li
      className="rounded border border-border bg-card px-3 py-2"
      data-testid="coord-followup"
      data-edge-id={f.edge_id}
      data-state={state}
    >
      {/* IN FULL. The note is the finding and it has no other home —
          see `followupStatus.ts`'s module docstring, property 1. */}
      <p
        className="text-sm text-foreground/90 whitespace-pre-wrap"
        data-testid="coord-followup-note"
      >
        {f.note}
      </p>

      {anchors.length > 0 ? (
        <ul
          className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono text-muted-foreground"
          data-testid="coord-followup-anchors"
        >
          {anchors.map((a) => (
            <li
              key={`${a.repo}:${a.path}:${a.line_start ?? ""}`}
              data-testid="coord-followup-anchor"
              title={a.symbol ?? undefined}
            >
              {formatAnchor(a)}
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="coord-followup-unanchored"
        >
          {f.unanchored_reason
            ? `names no file: ${f.unanchored_reason}`
            : "names no file — no anchor recorded, so no diff can match it"}
        </p>
      )}

      {state === "fixing" && (
        <p
          className="mt-1 text-xs text-foreground/80"
          data-testid="coord-followup-fixing"
        >
          fixing in{" "}
          {href ? (
            <a
              href={href}
              className="font-mono underline"
              target="_blank"
              rel="noreferrer"
              data-testid="coord-followup-pr"
            >
              {pr}
            </a>
          ) : (
            <span className="font-mono" data-testid="coord-followup-pr">
              {pr ?? "an unrecorded PR"}
            </span>
          )}
          {" · "}
          <span data-testid="coord-followup-fixing-age">
            {inState === null
              ? "for an unknown time"
              : `for ${Math.round(inState)}d`}
          </span>
        </p>
      )}

      {(state === "fixed" ||
        state === "already_fixed" ||
        state === "dismissed") && (
        <p
          className="mt-1 text-xs text-foreground/80"
          data-testid="coord-followup-resolution"
        >
          {state.replace("_", " ")}
          {pr && (
            <>
              {" by "}
              <span className="font-mono">{pr}</span>
            </>
          )}
          {f.resolution_commit && (
            <>
              {" at "}
              <span className="font-mono">
                {f.resolution_commit.slice(0, 12)}
              </span>
            </>
          )}
          {state === "fixed" && !f.resolution_commit && (
            <> (coord recorded no land commit)</>
          )}
          {f.resolved_at && (
            <>
              {" · "}
              <span title={absoluteTime(f.resolved_at)}>
                {relativeTime(f.resolved_at)}
              </span>
            </>
          )}
          {f.resolved_by && <> · by {f.resolved_by}</>}
          {f.resolution_note && (
            <span className="block whitespace-pre-wrap text-muted-foreground">
              {f.resolution_note}
            </span>
          )}
        </p>
      )}

      <p className="text-xs text-muted-foreground mt-1">
        surfaced by{" "}
        <span className="font-mono" title={f.from_title}>
          {f.from_slug}
        </span>{" "}
        <span className="text-muted-foreground/70">({f.from_kind})</span>
        {" · "}
        <span data-testid="coord-followup-size">
          {f.size_class ?? "unclassified"}
        </span>
        {state === "open" && typeof f.age_days === "number" && (
          <>
            {" · "}
            <span data-testid="coord-followup-age">
              {Math.round(f.age_days)}d unowned
            </span>
          </>
        )}
        {" · "}
        <span title={absoluteTime(f.created_at)}>
          recorded {relativeTime(f.created_at)}
        </span>
        {f.created_by && <> · by {f.created_by}</>}
      </p>

      {state === "open" && !dismissOpen && (
        <div className="mt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            data-testid="coord-followup-dismiss"
          >
            Dismiss
          </Button>
        </div>
      )}

      {state === "open" && dismissOpen && (
        <div
          className="mt-2 space-y-2"
          data-testid="coord-followup-dismiss-form"
        >
          <Textarea
            rows={2}
            placeholder="Why is this follow-up being closed without a fix? (required)"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            data-testid="coord-followup-dismiss-reason"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={submitting || !reason.trim()}
              data-testid="coord-followup-dismiss-confirm"
            >
              {submitting ? "Dismissing…" : "Dismiss with this reason"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              data-testid="coord-followup-dismiss-cancel"
            >
              Cancel
            </Button>
          </div>
          {dismissError && (
            <p
              className="text-xs text-destructive"
              data-testid="coord-followup-dismiss-error"
            >
              Dismiss failed: {dismissError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
