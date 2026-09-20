"use client";

/**
 * /admin/coord/plan-candidates — unshipped plans with their ranking inputs.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * The consumer for `GET /api/v1/plan-library/candidates`, which had none: a
 * `git grep` for the route name across `frontend/**` on `origin/main` matched
 * only the two generated OpenAPI snapshots. An unconsumed route is not
 * neutral — it is a maintained surface with tests, an OpenAPI entry and a
 * contract, delivering nothing [policy: `capability-ships-enabled`].
 *
 * ## It shows evidence and emits no verdict
 *
 * The route is explicit (design decision D6) that there is no criticality
 * score, because *"a hardcoded score would be a guess frozen into SQL"*. This
 * page is the same shape: the only ordering is the route's declared
 * `oldest_vetted_first`, there is no sort control that would imply a ranking,
 * and the readiness badge is a statement about dependencies rather than a
 * priority.
 *
 * ## The three disclosures it owes, and why they are not footnotes
 *
 * 1. **`work_unit_population_state`.** On `unavailable` the union's coord arm
 *    never ran, so `total` counts the document layer alone — on this fleet as
 *    little as a 2% view of the corpus. The strip DASHES the count on that
 *    arm rather than publishing a number over a denominator that moved.
 * 2. **`corpus_health`, or the reason it is missing.** A ranking drawn from a
 *    frozen corpus is a ranking of the corpus, not of the work. `null` is
 *    UNKNOWN, never healthy, and `corpus_health_unavailable_reason` is
 *    rendered verbatim because it is the only description of what failed.
 *    Its `capture` census is the SAME block `/capture-health` serves, from the
 *    same builder, so it composes `<CaptureHealthPanel>` rather than growing
 *    a second rendering of one census.
 * 3. **`open_followups` rides along.** Work a plan surfaced and nobody owns
 *    is not an artifact, so it can never appear in `items` — before the route
 *    carried it, it was invisible to the one read whose job is answering
 *    "what should I pick up next". It is bounded by the same `limit` as the
 *    candidates, so `open_followup_total` is shown beside it and the full
 *    queue is a click away at `/admin/coord/plan-followups`.
 *
 * ## Console style
 *
 * R9 (no page-level card), R1 (`<HealthStrip>` off the response already
 * fetched), R2/R5 (one candidate is one `<RecordRow>`, detail in place), R6
 * (`–`, never `0`, for an unfetched or inadmissible count), R8 (every reading
 * derives in `candidateStatus.ts`).
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  StatusBadge,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import { CaptureHealthPanel } from "@/components/admin/coord/CaptureHealthPanel";
import { DisclosureLines } from "@/components/admin/coord/DisclosureLines";
import {
  deriveCaptureCensus,
  describeCorpusFreshness,
} from "@/components/admin/coord/captureHealthStatus";
import {
  useGuardedPoll,
  type ReadGuard,
} from "@/components/admin/coord/useGuardedPoll";
import { httpClient } from "@/services/service-factory";
import {
  CANDIDATE_PALETTE,
  deriveCandidateDisclosure,
  deriveCandidateHealth,
  describeCandidateWindow,
  describeCoordLink,
  describePrState,
  describeReadiness,
  type PlanCandidate,
  type PlanCandidateResponse,
} from "./candidateStatus";

const ENDPOINT = "/api/v1/plan-library/candidates";
const POLL_INTERVAL_MS = 60_000;
/** The route's own ceiling is 100 (`Query(25, ge=1, le=100)`). */
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

function CandidateRow({
  candidate,
  expanded,
  onToggle,
}: {
  candidate: PlanCandidate;
  expanded: boolean;
  onToggle: () => void;
}) {
  const readiness = describeReadiness(candidate);
  const coord = describeCoordLink(candidate.coord);
  const unmet = candidate.unmet_depends_on ?? [];
  const chain = candidate.prompt_chain ?? [];
  // NOT `?? "present"` — the same reading `describeReadiness` takes. A
  // response that did not carry `document_state` has not said which corpus
  // layer this row came from, and rendering `doc: present` would state it.
  const documentState = candidate.document_state ?? null;

  return (
    <RecordRow
      data-testid="coord-candidate-row"
      rowKey={candidate.slug}
      expanded={expanded}
      onToggle={onToggle}
      attention={readiness.attention}
      identity={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
      label={
        <span title={`${candidate.slug} — ${candidate.title}`}>
          <span className="font-mono">{candidate.slug}</span>
          {candidate.title && (
            <span className="text-muted-foreground"> — {candidate.title}</span>
          )}
        </span>
      }
      status={
        <>
          <span
            data-testid="coord-candidate-readiness"
            data-readiness={readiness.kind}
          >
            <StatusBadge status={readiness} palette={CANDIDATE_PALETTE} />
          </span>
          <span
            className="hidden sm:inline text-[11px] text-muted-foreground whitespace-nowrap"
            data-testid="coord-candidate-status"
          >
            {candidate.status || "no status"}
          </span>
          {/* `document_state` is the field that says which corpus layer this
              row came from, and the schema asks for it to be read BEFORE any
              document-layer field below it. */}
          <span
            className="hidden sm:inline text-[11px] text-muted-foreground whitespace-nowrap"
            data-testid="coord-candidate-document-state"
            data-document-state={documentState ?? "unstated"}
            title={
              documentState === "present"
                ? "An artifact row backs this candidate, so its body and edges are readable."
                : documentState === "unsynced"
                  ? "No artifact row — coord's work unit records a source_path, so a plan file exists and only the body sync is missing."
                  : documentState === "absent"
                    ? "No artifact row and no source_path: coord knows of the work and no document for it has been seen anywhere."
                    : "This response carried no document_state for this row, so which corpus layer it came from is UNKNOWN — it is not 'present'."
            }
          >
            doc: {documentState ?? "unstated"}
          </span>
          <span
            className={`hidden md:inline text-[11px] whitespace-nowrap ${coord.unknown ? "text-muted-foreground italic" : "text-muted-foreground"}`}
            data-testid="coord-candidate-coord"
            data-unknown={coord.unknown ? "true" : "false"}
            title={coord.detail}
          >
            {coord.label}
          </span>
        </>
      }
      reason={readiness.reason}
      reasonTestId="coord-candidate-reason"
      time={
        typeof candidate.age_days === "number" ? (
          <span
            data-testid="coord-candidate-age"
            title={`Last touched ${absoluteTime(candidate.last_touched)}`}
          >
            {Math.round(candidate.age_days)}d old
          </span>
        ) : undefined
      }
    >
      <RecordDetail
        data-testid="coord-candidate-detail"
        why={
          <div className="text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">Why: </span>
              <span className="text-foreground/90">{readiness.reason}</span>
            </div>
            <div>
              <span className="text-muted-foreground">coord: </span>
              <span
                className={
                  coord.unknown
                    ? "text-muted-foreground italic"
                    : "text-foreground/90"
                }
              >
                {coord.label}
              </span>
              <span className="text-muted-foreground"> — {coord.detail}</span>
            </div>
          </div>
        }
        problems={
          <div className="text-xs space-y-1.5">
            {unmet.length > 0 ? (
              <div data-testid="coord-candidate-unmet">
                <span className="text-muted-foreground">
                  Unmet dependencies (every one is non-terminal):
                </span>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {unmet.map((dep) => (
                    <li key={dep.id}>
                      <span className="font-mono">{dep.slug}</span> —{" "}
                      {dep.status}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div
                className="text-muted-foreground"
                data-testid="coord-candidate-unmet-empty"
              >
                {documentState === "present"
                  ? "No unmet dependency — its depends_on edges were walked and every target is terminal."
                  : documentState === null
                    ? "No dependency list, and no document_state to say whether there were edges to walk. Empty here is UNKNOWN, not unblocked."
                    : "No dependency list: this row has no artifact, so there were no edges to walk. Empty here is UNKNOWN, not unblocked."}
              </div>
            )}
            <div data-testid="coord-candidate-prs">
              <span className="text-muted-foreground">PR citations: </span>
              <span
                className={
                  coord.prUnknown
                    ? "text-muted-foreground italic"
                    : "text-foreground/90"
                }
                data-pr-unknown={coord.prUnknown ? "true" : "false"}
              >
                {coord.prLabel}
              </span>
              {coord.prUnknown && (
                <span className="text-muted-foreground">
                  {" "}
                  — coord could not be read for citations. UNKNOWN, not
                  &ldquo;this plan has no PRs&rdquo;.
                </span>
              )}
              {coord.prs.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {coord.prs.map((pr) => (
                    <li key={`${pr.repo}#${pr.pr_number}`}>
                      <span className="font-mono">
                        {pr.repo}#{pr.pr_number}
                      </span>{" "}
                      — {describePrState(pr)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {chain.length > 0 && (
              <div data-testid="coord-candidate-chain">
                <span className="text-muted-foreground">
                  What produced this plan (depth 1 is the direct producer):
                </span>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {chain.map((link) => (
                    <li key={link.id}>
                      d{link.depth} · {link.relation} ·{" "}
                      <span className="font-mono">{link.slug}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 space-y-0.5">
            <div>kind: {candidate.kind}</div>
            <div>slug: {candidate.slug}</div>
            <div>artifact: {candidate.id ?? "none (work-unit-only row)"}</div>
            {candidate.source_repo && (
              <div>
                source: {candidate.source_repo}
                {candidate.source_path ? `/${candidate.source_path}` : ""}
              </div>
            )}
            <div>work_unit_slug: {candidate.work_unit_slug ?? "null"}</div>
            <div>difficulty: {candidate.difficulty ?? "unrated"}</div>
          </div>
        }
      />
    </RecordRow>
  );
}

export default function CoordPlanCandidatesPage() {
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState<number>(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<PlanCandidateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guarded by `useGuardedPoll` — the two generation counters and the
   * in-flight lock, one spelling shared with `/admin/coord/plans`. This page
   * has a window control, so both races the hook documents are reachable
   * here: change the page size while a read is out and the superseded
   * response repaints the discarded window, or lands on top of a newer
   * failure and states a stale window as a confident answer.
   */
  const fetchData = useCallback(
    async (guard: ReadGuard) => {
      try {
        const qs = new URLSearchParams();
        qs.set("offset", String(offset));
        qs.set("limit", String(limit));
        const body = await httpClient.get<PlanCandidateResponse>(
          `${ENDPOINT}?${qs.toString()}`
        );
        if (!guard.isNewest()) return;
        setData(body);
        setError(null);
      } catch (e) {
        if (!guard.isCurrentQuestion()) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [offset, limit]
  );

  // The window is the question: changing it makes the rows already held
  // answers to a question nobody asked.
  const resetWindow = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  const { refresh } = useGuardedPoll({
    read: fetchData,
    intervalMs: POLL_INTERVAL_MS,
    onQuestionChange: resetWindow,
  });

  const loaded = data !== null;
  const readFailed = error !== null;
  const rows = useMemo(() => data?.items ?? [], [data]);
  const window = useMemo(
    () => (data ? describeCandidateWindow(data) : null),
    [data]
  );
  const disclosure = useMemo(
    () => (data ? deriveCandidateDisclosure(data) : null),
    [data]
  );
  const health = useMemo(
    () => deriveCandidateHealth(data, loaded, readFailed),
    [data, loaded, readFailed]
  );
  const capture = data?.corpus_health?.capture ?? null;
  const census = useMemo(
    () => (capture ? deriveCaptureCensus(capture) : null),
    [capture]
  );
  const freshness = useMemo(() => describeCorpusFreshness(capture), [capture]);

  // NOT collapsed to `[]`. A backend that did not carry `open_followups` has
  // said nothing about the queue; `[]` would render as "No open follow-up in
  // this read" — a measured zero beside a total that correctly shows `–`, so
  // the two halves of one paragraph would disagree.
  const followups = data?.open_followups;
  const followupsUnstated = loaded && followups === undefined;
  const followupTotal = data?.open_followup_total;

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-plan-candidates-page"
    >
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-plan-candidates-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Rows3 className="h-4 w-4 text-muted-foreground" />
        <Select
          value={String(limit)}
          onValueChange={(v) => {
            setOffset(0);
            setLimit(Number(v));
          }}
        >
          <SelectTrigger
            className="w-[150px]"
            data-testid="coord-candidates-page-size-select"
            title="Rows per page. The route caps this at 100."
          >
            <SelectValue placeholder="page size" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RefreshButton
          key={`${offset}:${limit}`}
          onRefresh={refresh}
          label="Refresh candidates"
          title={`Re-reads the candidates now; it also refreshes itself every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-candidates-refresh"
        />
      </div>

      {window && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-candidates-window"
        >
          Showing {window.shown} of{" "}
          {window.totalAdmissible && window.total !== null ? (
            window.total
          ) : (
            <span data-testid="coord-candidates-total-unknown">
              {window.total === null
                ? "an unknown total — the route served no count"
                : `a total (${window.total}) that counts the document layer alone on this read`}
            </span>
          )}{" "}
          unshipped plans, offset {window.offset}, page size{" "}
          {window.limit ?? "unstated"}, ordered{" "}
          <span
            className="font-mono"
            data-testid="coord-candidates-ordering"
            title="The route DECLARES its ordering so a consumer can assert it did not silently become something else. There is no alternative ordering and no scoring pass."
          >
            {window.ordering ?? "unstated"}
          </span>
          .
        </p>
      )}

      {disclosure && (
        <DisclosureLines
          lines={disclosure}
          testIdPrefix="coord-candidates-disclosure"
        />
      )}

      {/* The same census `/capture-health` serves, from the same builder —
          composed rather than re-rendered. It never repairs the population
          claim above it. */}
      <CaptureHealthPanel
        census={census}
        freshness={freshness}
        documentAxisSuppressed={
          data !== null && data.work_unit_population_state !== "included"
        }
        readFailed={readFailed || (loaded && capture === null)}
        loaded={loaded || readFailed}
      />

      {error && (
        <p
          className="text-sm text-destructive"
          data-testid="coord-candidates-error"
        >
          Failed to load: {error}
        </p>
      )}

      <RecordList
        items={rows}
        itemKey={(c) => c.slug}
        loaded={loaded || readFailed}
        skeletonRows={6}
        empty={
          readFailed && !loaded ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-candidates-unknown"
            >
              Could not read the candidates — whether anything is unshipped is
              unknown, not none.
            </p>
          ) : readFailed ? (
            // The third arm the two older pages carry: a failed refresh over
            // a loaded window is STALE, and present-tense measured copy over
            // it states a measurement that just failed.
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-candidates-stale"
            >
              This window held no unshipped plan at the last good read — it has
              not refreshed since.
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-candidates-empty"
            >
              No unshipped plan in this window.
            </p>
          )
        }
        renderRow={(candidate, ctx) => (
          <CandidateRow
            candidate={candidate}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
          />
        )}
      />

      <div
        className="flex items-center gap-2"
        data-testid="coord-candidates-paging"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
          data-testid="coord-candidates-page-prev"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!(window?.hasMore ?? false)}
          onClick={() => setOffset((o) => o + limit)}
          data-testid="coord-candidates-page-next"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* `open_followups` rides this response. It is bounded by the SAME limit
          the candidates use, so the unpaged total sits beside it and the whole
          queue is one link away — a truncated list must never read as the
          queue. */}
      <section className="space-y-2" data-testid="coord-candidates-followups">
        <h2 className="text-sm font-medium">
          Follow-ups nobody owns{" "}
          <span className="text-muted-foreground font-normal">
            (
            <span data-testid="coord-candidates-followup-total">
              {typeof followupTotal === "number" ? followupTotal : "–"}
            </span>{" "}
            open in total)
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Work a plan surfaced and deliberately did not do. It is not an
          artifact, so it can never appear above — which is why the route
          carries it separately.{" "}
          <Link
            href="/admin/coord/plan-followups"
            className="underline"
            data-testid="coord-candidates-followups-link"
          >
            The whole queue, oldest first
          </Link>
          .
        </p>
        {followupsUnstated ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-candidates-followups-unstated"
          >
            This backend served no follow-up list with the candidates, so
            whether anything is waiting for an owner is UNKNOWN — not none. The
            queue has its own page.
          </p>
        ) : (followups?.length ?? 0) === 0 ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-candidates-followups-empty"
          >
            {loaded
              ? typeof followupTotal === "number" && followupTotal > 0
                ? `This page carried none of the ${followupTotal} open follow-ups.`
                : "No open follow-up in this read."
              : "Follow-ups appear once the route answers — unknown, not none."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(followups ?? []).map((f) => (
              <li
                key={f.edge_id}
                className="rounded border border-border bg-card px-2.5 py-1.5 text-xs"
                data-testid="coord-candidates-followup"
              >
                {/* The note is the whole payload — with no far end there is
                    nowhere else for the finding to live — so it is rendered in
                    full, never truncated to a headline. */}
                <p className="text-foreground/90 whitespace-pre-wrap">
                  {f.note}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  surfaced by <span className="font-mono">{f.from_slug}</span>
                  {typeof f.age_days === "number" && (
                    <> · {Math.round(f.age_days)}d unowned</>
                  )}{" "}
                  ·{" "}
                  <span title={absoluteTime(f.created_at)}>
                    {relativeTime(f.created_at)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
