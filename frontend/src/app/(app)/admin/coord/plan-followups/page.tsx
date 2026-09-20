"use client";

/**
 * /admin/coord/plan-followups — work a plan surfaced and nobody owns.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * The consumer for `GET /api/v1/plan-library/followups`, which had none: a
 * `git grep` for the route name across `frontend/**` on `origin/main` matched
 * only the two generated OpenAPI snapshots [policy:
 * `capability-ships-enabled`].
 *
 * ## Why this page is a list of notes and not a row-per-record table
 *
 * R2 says one record is one line, and this surface deliberately does not obey
 * it. The reason is the payload: `note` IS the follow-up. With no far-end
 * artifact there is nowhere else for the finding to live — the schema requires
 * it non-blank for exactly that reason — and before this route existed it was
 * prose in a plan body, unrecoverable from the data. A one-line row with a
 * `…` and a click would put the product back there, so every note is rendered
 * in full. `followupStatus.ts` `noteIsTruncatable` is where that decision is
 * written down.
 *
 * Nothing on this page is red. An unowned follow-up is a backlog item the
 * fleet deliberately deferred, not an incident; R3 reserves red for "someone
 * must act NOW", and spending it here is how an eye learns to skip red.
 *
 * ## Empty is not "nothing was surfaced"
 *
 * A claimed follow-up becomes an ordinary two-ended provenance edge and drops
 * out of this list — but it is NOT deleted, and it stays on the originating
 * artifact's edge list, so the trail from "this plan surfaced it" to "that
 * plan owns it" survives the claim. An empty queue therefore means nothing is
 * UNOWNED. The page says so rather than letting the reader supply the other
 * reading.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HealthStrip,
  RefreshButton,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import { httpClient } from "@/services/service-factory";
import {
  EXPECTED_ORDERING,
  deriveFollowupHealth,
  describeFollowupWindow,
  type OpenFollowupResponse,
} from "./followupStatus";

const ENDPOINT = "/api/v1/plan-library/followups";
const POLL_INTERVAL_MS = 60_000;
/** The route's own default and ceiling: `Query(50, ge=1, le=200)`. */
const PAGE_SIZE = 50;

export default function CoordPlanFollowupsPage() {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<OpenFollowupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      qs.set("offset", String(offset));
      qs.set("limit", String(PAGE_SIZE));
      const body = await httpClient.get<OpenFollowupResponse>(
        `${ENDPOINT}?${qs.toString()}`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [offset]);

  useEffect(() => {
    setData(null);
    setError(null);
    void fetchData();
    const id = setInterval(() => void fetchData(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const loaded = data !== null;
  const readFailed = error !== null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const window = useMemo(
    () => (data ? describeFollowupWindow(data) : null),
    [data]
  );
  const health = useMemo(
    () => deriveFollowupHealth(data, loaded, readFailed),
    [data, loaded, readFailed]
  );

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

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          key={offset}
          onRefresh={fetchData}
          label="Refresh follow-ups"
          title={`Re-reads the queue now; it also refreshes itself every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-followups-refresh"
        />
        <p className="text-xs text-muted-foreground">
          Open only. A claimed follow-up becomes an ordinary provenance edge and
          drops out of this list — it is not deleted, and it stays on the plan
          that surfaced it. Candidates that carry these along are at{" "}
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
          open follow-ups, offset {window.offset}, page size{" "}
          {window.limit ?? "unstated"}, ordered{" "}
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
          Reading the follow-up queue…
        </p>
      )}

      {readFailed && !loaded && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-followups-unknown"
        >
          Could not read the follow-up queue — whether anything is waiting for
          an owner is unknown, not none.
        </p>
      )}

      {loaded && items.length === 0 && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-followups-empty"
        >
          Nothing is waiting for an owner in this window. A claimed follow-up
          drops out of this list without being deleted, so this is not &ldquo;no
          plan surfaced any follow-up&rdquo;.
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2" data-testid="coord-followups-list">
          {items.map((f) => (
            <li
              key={f.edge_id}
              className="rounded border border-border bg-card px-3 py-2"
              data-testid="coord-followup"
              data-edge-id={f.edge_id}
            >
              {/* IN FULL. The note is the finding and it has no other home —
                  see `followupStatus.ts` `noteIsTruncatable`. */}
              <p
                className="text-sm text-foreground/90 whitespace-pre-wrap"
                data-testid="coord-followup-note"
              >
                {f.note}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                surfaced by{" "}
                <span className="font-mono" title={f.from_title}>
                  {f.from_slug}
                </span>{" "}
                <span className="text-muted-foreground/70">
                  ({f.from_kind})
                </span>
                {typeof f.age_days === "number" && (
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
            </li>
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
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          data-testid="coord-followups-page-prev"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!(window?.hasMore ?? false)}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          data-testid="coord-followups-page-next"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
