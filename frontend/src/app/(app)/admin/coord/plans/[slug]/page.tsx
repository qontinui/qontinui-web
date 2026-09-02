"use client";

/**
 * /admin/coord/plans/[slug] — single work-unit view.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2);
 * repointed onto the generic work-unit primitive
 * (`2026-06-18-coord-generic-work-unit-primitive`).
 *
 * The operator UX stays "Plans"; coord now stores plans as generic
 * slug-keyed work-units. The web proxy serves the same
 * `/api/v1/operations/plans/{slug}*` paths, now backed by coord
 * `/coord/work-units/{slug}*`.
 *
 * Renders:
 *   - Work-unit metadata (slug / status). The detail envelope is
 *     `{work_unit: {...}, recent_history: [...]}`.
 *   - Status history timeline from `coord.work_unit_status_history`
 *     (rows: `{from_status?, to_status, transitioned_at, by_actor?, reason?}`)
 *   - Transition button — POST /api/v1/operations/plans/{slug}/transition
 *
 * Work-units have no markdown body, so the plan-only body surfaces are
 * dropped. They DO carry `current_phase`, a derived `first_shipped_at` (the
 * first transition into `shipped` — there is no `shipped_at`; a field by that
 * name sat on `CoordPlanRow` for months with nothing serving it) and a
 * nullable slug-derived `authored_at` (plan
 * `2026-09-02-coord-work-units-carry-no-authoring-date`). The meta strip
 * shows `authored` beside `updated`, and says "not recorded" when coord has
 * no authoring date rather than substituting the ingest date.
 *
 * ## Console style (Phase 3 Wave 3)
 *
 * The ROUTE survives (D1 — this page is a workspace: it owns the transition
 * lever and the status history, and it is the target of the "Open full page"
 * action `<PlanRow>` gained in Wave 1). What changed, per
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — three `<Card><CardHeader><CardTitle>` section wrappers are gone;
 *   each cost ~72px of header to label a section a heading labels as well.
 * - **R3/R4/R8** — the work-unit's status is now the SAME `<StatusBadge>`
 *   `/plans` renders (`derivePlanStatus`), with the matching left-edge accent.
 *   It was a bare `<Badge variant="outline">{plan.status}</Badge>` printing the
 *   raw coord enum — R8's "no internal vocabulary on a primary surface", and
 *   it also meant a `blocked` work unit read exactly like a `draft` one here
 *   while reading red one click away.
 * - **R2** — `updated_at` and each history row's `transitioned_at` were RAW
 *   ISO strings. They render through `<RowTime>` now: relative in the row,
 *   absolute in the title.
 * - **R5** — the status history is a list, so it gets the list primitives: one
 *   transition is one line, and the full reason / prior status / actor expand
 *   in place instead of being truncated into the line.
 * - **R7** — the history collapses (open by default; the choice persists), and
 *   its count stays visible in the collapsed header.
 *
 * Every authored `data-testid` is carried across unchanged (D4a).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowRight, GitCommit, History } from "lucide-react";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatusBadge,
  isNotFoundError,
  rowAccentProps,
} from "@/components/console";
import {
  PLAN_STATUS_PALETTE,
  derivePlanStatus,
  describePlanStatus,
} from "@/components/admin/coord/planStatus";
import { httpClient } from "@/services/service-factory";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";

const API = "/api/v1/operations";

// Work-unit lifecycle statuses. NB `ready`/`shipped` are coord-DERIVED on
// the device write path, but the operator-transition route is a trusted
// admin lever that may set any status, so they remain offered here.
const TRANSITION_TARGETS = [
  "draft",
  "vetted",
  "in_progress",
  "blocked",
  "ready",
  "shipped",
  "superseded",
  "obsolete",
];

interface CoordWorkUnit {
  slug: string;
  title?: string | null;
  status?: string;
  /**
   * coord `work_units.current_phase`. Omitted from this interface until
   * 2026-08-29, which silently disarmed `derivePlanStatus`'s `reason` — it
   * reads exactly this field, so the badge could never produce its "phase N"
   * subtitle here even though `/plans` and `/spawn` show it for the same work
   * unit. The deriver was doing its job; it was being handed a type that had
   * thrown the input away.
   */
  current_phase?: string | null;
  /**
   * coord `work_units.authored_at` — slug-derived authoring date, NULL when
   * not recorded (an undated slug, or a coord predating the column). Never
   * stood in for by `created_at`, which is the ingest time.
   */
  authored_at?: string | null;
  /** coord `work_units.updated_at` — the scanner's last touch, not a plan event. */
  updated_at?: string | null;
  /** coord `work_units.first_shipped_at` — derived first `shipped` transition. */
  first_shipped_at?: string | null;
}

// coord `GET /coord/work-units/{slug}` envelope.
interface CoordPlanDetailResponse {
  work_unit?: CoordWorkUnit;
  recent_history?: PlanHistoryEntry[];
}

// One `coord.work_unit_status_history` row.
interface PlanHistoryEntry {
  from_status?: string | null;
  to_status: string;
  transitioned_at: string;
  by_actor?: string | null;
  reason?: string | null;
}

interface PlanHistoryResponse {
  slug?: string;
  history?: PlanHistoryEntry[];
}

export default function CoordPlanDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = useMemo(() => {
    const raw = params?.slug;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [plan, setPlan] = useState<CoordWorkUnit | null>(null);
  const [history, setHistory] = useState<PlanHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The last detail read failed with coord's own 404 — i.e. coord ANSWERED,
   * and the answer was "no such work unit".
   *
   * `httpClient.get` throws on every non-2xx, so a 404 arrives through the same
   * `catch` as a dead socket; without this the two are indistinguishable and
   * the page must either call every genuine 404 an outage or every outage a
   * 404. Both are wrong, and the first is the one that trains an operator to
   * distrust the console.
   */
  const [notFound, setNotFound] = useState(false);
  /**
   * R6 — the history read gets its OWN flag. It used to fail into a bare
   * `catch {}`, leaving `history` at the `[]` its initializer put there, which
   * is byte-identical to the array coord returns for a work unit that has never
   * transitioned. The panel then printed a `0` badge and "No status history
   * yet." — a confirmed absence, asserted from a read that never answered.
   */
  const [historyError, setHistoryError] = useState(false);
  /**
   * Something ANSWERED about this plan's history — either the detail envelope
   * carried a `recent_history` key, or the history endpoint returned.
   *
   * This is the history panel's own `loaded`, and it exists for the same
   * reason `readIsUnknown` keys on `loaded` rather than on a list being empty:
   * a plan with genuinely zero transitions is a fetched zero, and dashing it
   * because a supplementary endpoint then failed would report a real answer as
   * ignorance. Presence of the KEY is the signal, not the length of the array
   * behind it.
   */
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [newStatus, setNewStatus] = useState("in_progress");
  const [note, setNote] = useState("");
  const [transitioning, setTransitioning] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!slug) return;
    // Cleared at the START of the cycle, not only on the inner success path.
    // Left to the success path, a `historyError` raised for a DIFFERENT slug —
    // or by a previous poll whose detail read then threw, skipping the inner
    // try entirely — survives into the next render and mislabels rows it was
    // never computed from.
    setHistoryError(false);
    try {
      const planBody = await httpClient.get<CoordPlanDetailResponse>(
        `${API}/plans/${encodeURIComponent(slug)}`
      );
      setPlan(planBody.work_unit ?? null);
      // History is best-effort — don't fail the whole page if it errors.
      // The detail envelope already carries `recent_history`; seed from it,
      // then refine with the full history endpoint.
      setHistory(planBody.recent_history ?? []);
      // The envelope answering at all counts, even with an empty array — that
      // is coord saying "no transitions", not coord saying nothing.
      if (planBody.recent_history !== undefined) setHistoryLoaded(true);
      try {
        const historyBody = await httpClient.get<PlanHistoryResponse>(
          `${API}/plans/${encodeURIComponent(slug)}/history`
        );
        setHistory(historyBody.history ?? planBody.recent_history ?? []);
        if (historyBody.history !== undefined) setHistoryLoaded(true);
        setHistoryError(false);
      } catch {
        // Still supplementary — it must not fail the page — but "supplementary"
        // is not "unrecordable". The envelope's `recent_history` may have
        // seeded rows above; if it did they stand, and only their completeness
        // is unknown.
        setHistoryError(true);
      }
      setError(null);
      setNotFound(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotFound(isNotFoundError(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    // Drop the PREVIOUS slug's record before asking about this one. Without
    // this the catch never nulls `plan`, so navigating to a slug that 404s
    // renders the last plan's full detail under the new slug's breadcrumb —
    // and both the "not found" and "unknown" arms below sit behind
    // `plan === null`, so neither can ever be reached.
    //
    // This effect keys on `fetchAll`, which keys on `slug`, so it fires on a
    // route change and NOT on `onTransition`'s refresh — which calls
    // `fetchAll()` directly and would otherwise flash a loaded page to a
    // skeleton. This route does not poll, so a param change is the only time
    // the retained record belongs to a different question.
    setPlan(null);
    setHistory([]);
    setHistoryLoaded(false);
    setHistoryError(false);
    setError(null);
    setNotFound(false);
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  const onTransition = useCallback(async () => {
    if (!slug || !newStatus) return;
    setTransitioning(true);
    try {
      await httpClient.post(
        `${API}/plans/${encodeURIComponent(slug)}/transition`,
        {
          status: newStatus,
          note: note || undefined,
        }
      );
      toast.success(`Plan transitioned to ${newStatus}`);
      setNote("");
      await fetchAll();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to transition plan"
      );
    } finally {
      setTransitioning(false);
    }
  }, [slug, newStatus, note, fetchAll]);

  /** The history read failed and NOTHING has answered about it — the same
   *  `loaded`-keyed shape as `readIsUnknown`, not the list-is-empty spelling
   *  that would report a plan's genuine zero transitions as ignorance. */
  const historyUnknown = historyError && !historyLoaded;
  /** The detail read failed in a way that is NOT coord answering "no such
   *  work unit" — so nothing is known about whether this plan exists. */
  const readUnreadable = error !== null && !notFound;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto"
      data-testid="coord-plan-detail-page"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/plans")}
          data-testid="coord-plan-back-btn"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Plans
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-sm">{slug}</span>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {loading && !plan ? (
        <Skeleton className="h-32 w-full" />
      ) : plan ? (
        <>
          {/* R9/R3/R4 — one bordered strip carrying the same status badge and
              left-edge accent `/plans` renders, not a Card with a header. */}
          <div
            data-testid="coord-plan-meta"
            {...rowAccentProps(
              derivePlanStatus(plan),
              "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-1.5"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                work unit
              </Badge>
              <span className="text-base font-medium min-w-0 break-words">
                {plan.title || plan.slug}
              </span>
              <StatusBadge
                status={derivePlanStatus(plan)}
                palette={PLAN_STATUS_PALETTE}
              />
              {/* Each time is prefixed with its own word because three sit on
                  one line and a bare "3d ago" would not say which. An absent
                  authoring date is stated, not filled from `created_at`. */}
              <span data-testid="coord-plan-authored">
                <RowTime
                  at={plan.authored_at}
                  verb="Authored"
                  prefix="authored "
                  absent={{
                    label: "authored not recorded",
                    title:
                      "coord holds no authoring date for this work unit — its slug carries no YYYY-MM-DD prefix, or coord predates the column.",
                  }}
                />
              </span>
              {plan.first_shipped_at && (
                <RowTime
                  at={plan.first_shipped_at}
                  verb="Shipped"
                  prefix="shipped "
                />
              )}
              {plan.updated_at && (
                <RowTime
                  at={plan.updated_at}
                  verb="Updated"
                  prefix="updated "
                />
              )}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
              work_unit slug: {plan.slug}
              {plan.status ? ` · coord status: ${plan.status}` : ""}
            </div>
          </div>

          <CoordAdminOnly
            fallback={
              <div
                data-testid="coord-plan-transition-readonly"
                className="rounded-lg border border-border bg-card/30 px-4 py-3"
              >
                <ReadOnlyNotice label="Plan status transitions are administrator only." />
              </div>
            }
          >
          <section
            data-testid="coord-plan-transition"
            className="space-y-3 rounded-lg border border-border bg-card/30 px-4 py-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <GitCommit className="h-4 w-4" />
              Transition status
            </h2>
            <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">
                    new status
                  </label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger
                      className="w-[180px]"
                      data-testid="coord-plan-new-status"
                    >
                      <SelectValue placeholder="status" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSITION_TARGETS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground">
                    note (optional)
                  </label>
                  <Input
                    placeholder="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    data-testid="coord-plan-transition-note"
                  />
                </div>
                <Button
                  onClick={onTransition}
                  disabled={transitioning || !newStatus}
                  data-testid="coord-plan-transition-submit"
                >
                {transitioning ? "Transitioning..." : "Apply"}
              </Button>
            </div>
          </section>
          </CoordAdminOnly>

          {/* R7 — the transition log is supporting material, so it folds; its
              count stays visible in the collapsed header so an empty history
              is never something you have to open the panel to learn. */}
          <CollapsiblePanel
            titleAs="h2"
            className="p-3"
            defaultOpen
            storageKey="coord-plan-history"
            icon={<History className="h-3.5 w-3.5" />}
            title="Status history"
            summary={
              <Badge
                variant="outline"
                className="font-mono text-[11px]"
                title={
                  historyUnknown
                    ? "The history read failed; how many transitions this plan has is unknown."
                    : historyError
                      ? "The history read failed. These rows came from the detail envelope and may be incomplete."
                      : undefined
                }
              >
                {/* R6 — `–`, never `0`, for a count nobody managed to fetch.
                    A count that IS fetched but possibly incomplete stays a
                    plain number: the console spells partial counts `N/M`
                    (`rows 1/400`) and there is no M here, so the caveat goes
                    in words below the list rather than as notation with no
                    legend. */}
                {historyUnknown ? "–" : history.length}
              </Badge>
            }
            data-testid="coord-plan-history"
          >
            {/* R2/R5 — one transition is one line. The prior status, the full
                reason and the actor expand in place rather than being
                truncated into it. */}
            <RecordList
              items={history}
              // A history row carries no id, and two rows CAN share a
              // timestamp (a bulk transition), so the index is the tie-break —
              // appended, never used alone (see `RecordList`'s itemKey doc).
              itemKey={(h, i) => `${h.transitioned_at}-${h.to_status}-${i}`}
              empty={
                historyUnknown ? (
                  <p
                    className="text-sm text-muted-foreground italic"
                    data-testid="coord-plan-history-unknown"
                  >
                    Could not read this plan&rsquo;s status history — whether it
                    has transitions is unknown, not none.
                  </p>
                ) : (
                  <p
                    className="text-sm text-muted-foreground italic"
                    data-testid="coord-plan-history-empty"
                  >
                    No status history yet.
                  </p>
                )
              }
              renderRow={(h, ctx) => {
                const status = derivePlanStatus({ status: h.to_status });
                const from = describePlanStatus(h.from_status);
                return (
                  <RecordRow
                    data-testid="coord-plan-history-row"
                    // The key `itemKey` already computed. Every other
                    // `<RecordRow>` in the repo sets this; without it the row
                    // emits no `data-row-key` and no spec can address one
                    // specific transition.
                    rowKey={ctx.rowKey}
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                    attention={status.attention}
                    identity={h.by_actor ? "by" : "→"}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        {h.from_status && (
                          <>
                            <span className="text-muted-foreground">
                              {from.label}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                          </>
                        )}
                        <span>{h.by_actor ?? "actor not recorded"}</span>
                      </span>
                    }
                    status={
                      <StatusBadge
                        status={status}
                        palette={PLAN_STATUS_PALETTE}
                      />
                    }
                    reason={h.reason ?? undefined}
                    time={<RowTime at={h.transitioned_at} verb="Transitioned" />}
                  >
                    <RecordDetail
                      why={
                        <div className="text-xs">
                          <span className="text-muted-foreground">
                            Transitioned to{" "}
                          </span>
                          <span className="text-foreground/90">
                            {status.label}
                          </span>
                          {h.from_status && (
                            <>
                              <span className="text-muted-foreground">
                                {" "}
                                from{" "}
                              </span>
                              <span className="text-foreground/90">
                                {from.label}
                              </span>
                            </>
                          )}
                        </div>
                      }
                      problems={
                        h.reason ? (
                          <p className="text-sm text-foreground whitespace-pre-wrap">
                            &ldquo;{h.reason}&rdquo;
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">
                            No reason recorded for this transition.
                          </p>
                        )
                      }
                      raw={
                        <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
                          {h.from_status ? `${h.from_status} → ` : ""}
                          {h.to_status}
                          {h.by_actor ? ` · actor: ${h.by_actor}` : ""}
                          {` · at: ${h.transitioned_at}`}
                        </div>
                      }
                    />
                  </RecordRow>
                );
              }}
            />
            {/* The rows above are real — the detail envelope's `recent_history`
                seeded them — but the endpoint that would have completed the
                list did not answer, so the list may be short. Said in words,
                under the list it qualifies. */}
            {historyError && !historyUnknown && (
              <p
                className="mt-1.5 text-[11px] text-muted-foreground"
                data-testid="coord-plan-history-partial"
              >
                The history endpoint did not answer. These transitions came
                from the plan envelope and may be incomplete.
              </p>
            )}
          </CollapsiblePanel>

        </>
      ) : readUnreadable ? (
        // R6 — "not found" is a claim about coord's CORPUS; a read that never
        // landed supports no such claim. The red line above says what broke;
        // this line must not turn it into a verdict about whether the plan
        // exists. A 404 is the opposite case and keeps the sentence below.
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-plan-detail-unknown"
        >
          Could not read plan {slug} — whether it exists is unknown, not no.
        </p>
      ) : (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-plan-detail-missing"
        >
          Plan {slug} not found.
        </p>
      )}
    </div>
  );
}
