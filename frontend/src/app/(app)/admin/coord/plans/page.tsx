"use client";

/**
 * /admin/coord/plans — list coord work-units, filter by status.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2);
 * repointed onto the generic work-unit primitive
 * (`2026-06-18-coord-generic-work-unit-primitive`).
 *
 * Operators still author markdown plans; coord now stores them as generic
 * slug-keyed work-units (`coord.work_units`). The operator UX stays "Plans"
 * — this is a data-source repoint, not a rename. The web proxy still serves
 * `/api/v1/operations/plans*`; only the coord upstream moved to
 * `/coord/work-units*`, whose list envelope is `{work_units: [...]}`.
 *
 * ## Console style (Phase 3 Wave 1)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Plans` wrapper is
 *   gone. `coord/layout.tsx` already renders the console `<h1>` and the nav
 *   crumb, so that header was a second title costing ~72px above the fold.
 * - **R1** — a `<HealthStrip>` derived from the rows ALREADY FETCHED opens the
 *   page. No second request: the counts come from the same list the rows do.
 * - **R2/R5** — one work unit is one `<PlanRow>` line; detail expands in place
 *   (`<RecordList>` keeps one open at a time).
 * - **R7** — the fetch-window statement (complete / INCOMPLETE / truncated,
 *   missing authoring dates) collapses into a `<CollapsiblePanel>` whose
 *   summary badge stays visible, so the warning cannot hide behind the click.
 *
 * ## The whole corpus, not a window (plan `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`)
 *
 * Every sort but "Recently updated" / "Least recently updated" WALKS coord's
 * list in `order=authored_desc` along its keyset cursor (`planWalk.ts`), so a
 * plan cannot fall past a 500-row cap chosen by mutation time. A coord that
 * predates the walk answers with one `updated_at`-ordered page and no `order`
 * echo; the page then shows that page and names the `updated_at` span it
 * covers. The two `updated_*` sorts stay a single `order=updated_desc` page —
 * the explicit "recently touched" view.
 *
 * ## Which date (plan `2026-09-02-coord-work-units-carry-no-authoring-date`)
 *
 * The default sort is `authored_desc` on the plan's EFFECTIVE authoring date
 * (`planAuthoredAt`: the slug's date prefix, else coord's `authored_at`), and
 * the "undated" caveat counts rows with NEITHER. It used to be
 * `created_desc` on `created_at` — the INGEST time, a bulk-backfill date for
 * most of the corpus — under the label "Newest created", so a plan written in
 * May sorted as a June plan. With a coord that predates the column every row
 * is undated: they all sink, the caveat says "N of N", and the row falls back
 * to "Ingested <created_at>" — true, and labelled as what it is.
 *
 * **The status `<Select>` deliberately stays a Select, not `<FilterTabs>`.**
 * It is a SERVER-side filter — the value goes to coord as `?status=` and
 * changes what is fetched — so tab counts would be `–` for all nine options on
 * every render but one. R6's dash rule permits that; it would still be a
 * strictly worse control than the Select, and `coord-plans-status-select` is a
 * frozen authored testid (D4a). The counts operators actually want are in the
 * health strip, derived from the window that WAS fetched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownUp, Filter, ListChecks, TriangleAlert } from "lucide-react";
import {
  CollapsiblePanel,
  HealthStrip,
  RecordList,
  RefreshButton,
  readIsUnknown,
} from "@/components/console";
import { PlanRow } from "@/components/admin/coord/PlanRow";
import { planAuthoredAt } from "@/components/admin/coord/planStatus";
import { httpClient } from "@/services/service-factory";
import { sortPlans, SORTS, type SortKey } from "./planSort";
import {
  WALK_MAX_PAGES,
  WALK_PAGE_LIMIT,
  formatInstant,
  overviewTotalFor,
  serverOrderFor,
  timeSpan,
  walkWorkUnits,
  type WalkOutcome,
  type WorkUnitOverview,
} from "./planWalk";
import { derivePlansHealth, SHEPHERD_SLUG_PREFIX } from "./plansHealth";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

// Work-unit lifecycle statuses (coord stores status as an opaque string;
// these are the canonical lifecycle words the filter offers as a convenience
// — an exact-match `status=` filter on the coord list).
const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "ready", label: "Ready" },
  { value: "shipped", label: "Shipped" },
  { value: "superseded", label: "Superseded" },
  { value: "obsolete", label: "Obsolete" },
];

/** One answered question: the walk's outcome, plus coord's corpus tally. */
interface PlansWindow {
  outcome: WalkOutcome;
  /**
   * coord's `/overview` tally, read only when the walk ran (a coord new enough
   * to walk is new enough to serve it). `null` = unread or failed — UNKNOWN,
   * so the page says the count is not cross-checked rather than comparing
   * against nothing.
   */
  overview: WorkUnitOverview | null;
}

const PARTIAL_REASON_COPY = {
  error: "a page read failed",
  page_cap: `it reached its ${WALK_MAX_PAGES}-page safety cap`,
  stalled: "coord returned a cursor that did not advance",
} as const;

export default function CoordPlansListPage() {
  const [status, setStatus] = useState("any");
  const [sort, setSort] = useState<SortKey>("authored_desc");
  const [data, setData] = useState<PlansWindow | null>(null);
  // The server order is part of the QUESTION (it decides what is fetched);
  // the client sort within an order is not, so switching between two walked
  // sorts re-sorts the rows already on the page instead of re-reading.
  const order = serverOrderFor(sort);
  const [error, setError] = useState<string | null>(null);
  // There is deliberately no `loading` flag. It used to gate the list's
  // `loaded` prop, and the two questions it conflated are what let a
  // fabricated absence through: "is a request outstanding?" is not "has this
  // question been answered?", and only the second one may decide whether the
  // page is allowed to say "no plans match". `data !== null || error !== null`
  // answers the second directly, so the flag had no reader left.

  /**
   * Generation guard — a read may only speak while it is still the newest one.
   *
   * Without it the reset below narrows the bug instead of closing it: the read
   * issued under the PREVIOUS `status` is still live, still holds its own
   * closure, and lands on `setData`/`setError` unconditionally. Both arms are
   * reachable by changing the filter while the first load is in flight, which
   * is the ordinary case, not a corner:
   *
   *   - the superseded SUCCESS repaints the discarded window under the new
   *     filter, for a whole poll interval;
   *   - worse, it lands on top of a new read that FAILED — `setError(null)`
   *     clears the banner, `loaded` flips true, and the old window is stated
   *     as a confident answer to a question that errored. That is the
   *     fabricated-answer class this change exists to close, re-created in a
   *     race window.
   *
   * Same shape as `/notifications`' `queryGen`, `/questions`' three `*Seq`
   * refs and `usePlanLibrary`'s counter. `http-client.ts` now honours a
   * caller's `signal`, but cancelling a superseded read would not replace
   * these counters: they decide which settled read may land, not which reads
   * run.
   *
   * **TWO counters, because the two things being gated are not one question.**
   * A single per-request counter silences a read in every arm at once, and
   * that is how a page ends up stuck: `httpClient`'s request timeout is 60s
   * and its 5xx retry spends ~7s in backoff over four round trips, both far
   * longer than this page's 10s tick, so under a slow or retrying backend
   * every read is superseded before it settles and the failure is never
   * surfaced at all — the page waits on coord forever with nothing to show for
   * it. That is exactly the defect `readFailed` exists to prevent —
   * `plansHealth.tsx`: *"a first load that errors leaves `loaded` false and
   * renders 'Waiting for coord…' over a request that is never arriving"* —
   * re-created by the fix for a different one.
   *
   * So:
   *
   *   - `questionGen` (bumped in the effect, once per FILTER change) gates the
   *     ERROR. "This read failed" is true of the filter currently on screen
   *     whether or not a newer request has overtaken it, so an overtaken
   *     failure still gets to speak; a failure belonging to a filter the
   *     operator has left does not.
   *   - `reqGen` (bumped per call) additionally gates `setData`, so the newest
   *     response is the one rendered and two overlapping reads cannot land out
   *     of order.
   *
   * The residue is the asymmetry `/questions` states and accepts: a stale
   * FAILURE landing after a fresh success shows a banner the newest read
   * disagrees with. That fails safe — it over-reports trouble — where the
   * opposite silences it. `pollInFlight` keeps same-question ticks from
   * overlapping in the first place, and a refresh CLICK takes the same lock
   * when it is free (`refresh` below), so no tick can stack on a manual read
   * either. What remains is one narrower window: a click made while a poll
   * or the first read is already out still issues its own read, which is the
   * overlap `filterWindowReset.test.tsx` pins as guarded by the two counters.
   */
  const questionGen = useRef(0);
  const reqGen = useRef(0);
  /** One poll at a time — see the retry arithmetic above. */
  const pollInFlight = useRef(false);

  const fetchData = useCallback(async () => {
    const question = questionGen.current;
    const req = ++reqGen.current;
    // One guard for every read of the walk: a walk overtaken mid-way stops
    // issuing pages and lands nothing, exactly as a single read used to.
    const current = () =>
      question === questionGen.current && req === reqGen.current;
    try {
      const qs = new URLSearchParams();
      if (status && status !== "any") qs.set("status", status);
      qs.set("exclude_slug_prefix", SHEPHERD_SLUG_PREFIX);
      const outcome = await walkWorkUnits(
        (url) => httpClient.get(url),
        `${API}/plans`,
        qs,
        order,
        current
      );
      if (outcome === null || !current()) return;
      let overview: WorkUnitOverview | null = null;
      if (outcome.kind !== "single_page") {
        overview = await httpClient
          .get<WorkUnitOverview>(`${API}/plans/overview`)
          .catch(() => null);
        if (!current()) return;
      }
      setData({ outcome, overview });
      setError(null);
    } catch (e) {
      if (question !== questionGen.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [status, order]);

  useEffect(() => {
    // `status` and the server `order` are `fetchData`'s only dependencies, so
    // this effect re-runs exactly when the QUESTION changes — and the rows still in `data` answer
    // the previous one. Dropping them is not cosmetic: `loaded` is `data !==
    // null`, so keeping them leaves every read-state derivation on this page
    // reporting the OLD query while the new one is in flight — the list shows
    // the previous filter's records instead of skeletons, the strip describes
    // the previous window, and a new fetch that FAILS lands on the STALE arm
    // ("the last counts that landed") when nothing has ever landed for this
    // query. That is R6's own `loaded`-means-"answered-THIS-question" clause,
    // one level up from a count.
    //
    // It is cleared HERE and not in `fetchData`, which the poll also calls: a
    // poll must never blank a loaded page.
    //
    // The question generation is bumped here for the same reason — this is the
    // one place the QUESTION changes.
    questionGen.current += 1;
    const question = questionGen.current;
    /**
     * Release the poll lock only if it is still the one this read took.
     *
     * A read superseded by a filter change settles LATE — after the cleanup
     * has released the lock and the new question has taken it — so an
     * unconditional release would free a lock the NEW question's read is still
     * holding, and the next tick would issue a second concurrent read. Not
     * harmful (`reqGen` still picks the winner), but it would quietly falsify
     * the "one poll at a time" claim after every filter change, and a guard is
     * only worth having while its comment is true.
     */
    const releaseLock = () => {
      if (question === questionGen.current) pollInFlight.current = false;
    };
    setData(null);
    setError(null);
    // The FIRST read holds the lock too. Without that a tick 10s in issues a
    // second read of the same question while the first is still out, and the
    // first is then dropped for being superseded — which is only ever safe
    // when nothing downstream mistakes "no answer yet" for "no answer".
    pollInFlight.current = true;
    void fetchData().finally(releaseLock);
    const id = setInterval(() => {
      // A tick that outruns the previous read would otherwise stack: the
      // request timeout is 60s against a 10s interval, so a hung backend
      // accumulates six concurrent reads a minute for nothing.
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      void fetchData().finally(releaseLock);
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      // The lock was taken for a question that is over. Leaving it set would
      // have the new question's first few ticks skip while a read nobody is
      // waiting for finishes — bounded by the 60s timeout, but pointless.
      pollInFlight.current = false;
    };
  }, [fetchData]);

  /**
   * The refresh button's read — the operator's, never the poll's.
   *
   * It returns the read's promise so `<RefreshButton>` acknowledges the press
   * for exactly as long as that read is out; the poll calls `fetchData`
   * directly and has no path to that state, so the control never pulses on a
   * tick (plan `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`
   * F1).
   *
   * It TAKES `pollInFlight` when the lock is free, so the ticks that come due
   * while a manual read is out skip instead of stacking a second read of the
   * same question on top of it. When a poll already holds the lock the click
   * still issues its own read rather than waiting for or joining that one:
   * the operator asked for a read now, and the resulting overlap is exactly
   * what `questionGen`/`reqGen` above are for. The release is question-scoped
   * for the same reason as the effect's `releaseLock`: a filter change while
   * this read is out hands the lock to the new question's read, which this
   * one must not free.
   */
  const refresh = useCallback(() => {
    const tookLock = !pollInFlight.current;
    if (tookLock) pollInFlight.current = true;
    const question = questionGen.current;
    return fetchData().finally(() => {
      if (tookLock && question === questionGen.current) {
        pollInFlight.current = false;
      }
    });
  }, [fetchData]);

  const outcome = data?.outcome ?? null;
  const plans = useMemo(() => outcome?.rows ?? [], [outcome]);
  const sorted = useMemo(() => sortPlans(plans, sort), [plans, sort]);
  // A single page came back full (the "Recently updated" view, or a coord
  // that predates the walk), so there are almost certainly more work units
  // than are shown. Say so, and say which `updated_at` span they are.
  const truncated = outcome?.kind === "single_page" && outcome.truncated;
  const walkComplete = outcome?.kind === "complete";
  const walkPartial = outcome?.kind === "partial";
  const updatedSpan = truncated ? timeSpan(plans, (p) => p.updated_at) : null;
  // The walk runs on coord's `authored_at` COLUMN, so that is the range a
  // partial walk covered — not the slug-derived date the chips show.
  const authoredSpan = walkPartial
    ? timeSpan(plans, (p) => p.authored_at)
    : null;
  const reachedUndatedTail = walkPartial && plans.some((p) => !p.authored_at);
  const coordTotal = overviewTotalFor(data?.overview ?? null, status);
  const statusLabel = status === "any" ? "any" : status;
  // No authoring date from EITHER source — the slug carries no date prefix
  // AND coord holds no `authored_at` (`planAuthoredAt`, the deriver the chip,
  // the row time and the sort all read). Counting the bare column here would
  // call a dated slug with a NULL column "undated" while its own chip shows
  // the date. UNKNOWN either way: these rows sink in the sort and the caveat
  // says so.
  const missingAuthored = plans.filter((p) => !planAuthoredAt(p)).length;
  const loaded = data !== null;
  // R6 — "not fetched" includes "fetched and FAILED". The shared deriver grew
  // this arm for `/spawn`; this route reads the same list from the same
  // endpoint and had the same hole, so it consults it too.
  const readFailed = error !== null;
  const plansUnknown = readIsUnknown(loaded, readFailed);
  // ...and the third state, for the `empty=` slot. A poll that fails over a
  // window coord confirmed EMPTY leaves `data` non-null (the poll does not
  // blank a loaded page, deliberately), so the plain copy would otherwise
  // claim "No plans matching status=X" in the present tense while the read is
  // currently failing.
  const plansStale = readFailed && loaded;
  const health = useMemo(
    () => derivePlansHealth(plans, loaded, readFailed),
    [plans, loaded, readFailed]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-plans-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-plans-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            className="w-[180px]"
            data-testid="coord-plans-status-select"
          >
            <SelectValue placeholder="status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ArrowDownUp className="h-4 w-4 text-muted-foreground ml-1" />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger
            className="w-[200px]"
            data-testid="coord-plans-sort-select"
          >
            <SelectValue placeholder="sort" />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Keyed on the question: a press whose read was superseded by a filter
            change must not leave the NEW question's control busy for up to the
            60s request timeout, over a read whose answer will be discarded. */}
        <RefreshButton
          key={`${status}:${order}`}
          onRefresh={refresh}
          label="Refresh plans"
          title={`Re-reads the work-unit list now; it also refreshes itself every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-plans-refresh"
        />
      </div>

      {/* R7 — the window caveats are infrastructural, so they collapse; the
          summary badge keeps the signal visible while they are closed. */}
      {(truncated || walkComplete || walkPartial || missingAuthored > 0) && (
        <CollapsiblePanel
          titleAs="h2"
          className="p-2.5"
          defaultOpen={false}
          storageKey="coord-plans-window-caveats"
          icon={
            truncated || walkPartial || missingAuthored > 0 ? (
              <TriangleAlert className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
            )
          }
          title="Fetch window"
          summary={
            <span
              className={
                truncated || walkPartial || missingAuthored > 0
                  ? "text-xs text-amber-300/90 normal-case tracking-normal"
                  : "text-xs text-muted-foreground normal-case tracking-normal"
              }
            >
              {[
                walkComplete ? `all ${plans.length} shown` : null,
                walkPartial ? `INCOMPLETE — ${plans.length} shown` : null,
                truncated ? `capped at ${WALK_PAGE_LIMIT}` : null,
                missingAuthored > 0 ? `${missingAuthored} undated` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          }
          contentClassName="space-y-1"
          data-testid="coord-plans-window-caveats"
        >
          {outcome?.kind === "complete" && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-plans-walk-complete"
            >
              All {plans.length} work units matching status={statusLabel}{" "}
              (excluding coord&rsquo;s {SHEPHERD_SLUG_PREFIX}* merge records)
              are shown — the whole list was read in authoring order (
              {outcome.pages} page{outcome.pages === 1 ? "" : "s"}).{" "}
              {coordTotal
                ? `coord's overview counts ${coordTotal.total} work units ${
                    status === "any" ? "in total" : `with status=${status}`
                  }, INCLUDING its ${SHEPHERD_SLUG_PREFIX}* records, which this page excludes — so the two totals are measured over different sets, and the difference (${
                    coordTotal.total - plans.length
                  }) is not by itself a count of missing plans.`
                : "coord's corpus total could not be read, so this count is not cross-checked."}
            </p>
          )}
          {outcome?.kind === "partial" && (
            <p
              className="text-xs text-amber-300/90"
              data-testid="coord-plans-walk-partial"
            >
              INCOMPLETE — this list is NOT the whole corpus. {plans.length}{" "}
              work units are shown
              {authoredSpan
                ? `, authored ${formatInstant(authoredSpan.newest)} back to ${formatInstant(authoredSpan.oldest)}`
                : ""}
              {reachedUndatedTail ? ", plus some with no authoring date" : ""};
              the walk stopped after {outcome.pages} page
              {outcome.pages === 1 ? "" : "s"} because{" "}
              {PARTIAL_REASON_COPY[outcome.reason]}
              {outcome.error ? ` (${outcome.error})` : ""}.{" "}
              {reachedUndatedTail
                ? "Every dated work unit was reached; undated ones further along the list are missing from this page."
                : "Work units authored before that range, and every undated one, are missing from this page."}
              {coordTotal
                ? ` coord's overview counts ${coordTotal.total} work units ${
                    status === "any" ? "in total" : `with status=${status}`
                  } (including its ${SHEPHERD_SLUG_PREFIX}* records, which this page excludes).`
                : " coord's corpus total could not be read either."}
            </p>
          )}
          {outcome?.kind === "single_page" && truncated && (
            <p
              className="text-xs text-amber-300/90"
              data-testid="coord-plans-truncated-notice"
            >
              Showing the {WALK_PAGE_LIMIT} most-recently-updated work units
              {updatedSpan
                ? ` — updated ${formatInstant(updatedSpan.oldest)} to ${formatInstant(updatedSpan.newest)}`
                : ""}
              . Any work unit not updated in that span is NOT on this page.{" "}
              {outcome.legacyCoord
                ? "This coord predates the authored-order walk, so it caps the list at one page by update time."
                : "“Recently updated” is a single page by design; choose an authored sort to read the whole list."}{" "}
              Sorting applies to these only, so a &ldquo;
              {SORTS.find((s) => s.value === sort)?.label}&rdquo; result may not
              be the corpus-wide answer.
            </p>
          )}
          {missingAuthored > 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-plans-missing-authored-notice"
            >
              {missingAuthored} of {plans.length} have no authoring date — no
              date prefix on the slug and no authored_at in coord; they sort
              last rather than being treated as oldest.
            </p>
          )}
        </CollapsiblePanel>
      )}

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <RecordList
        items={sorted}
        itemKey={(p) => p.slug}
        // "Has this question been ANSWERED, one way or the other?" — never
        // "is a request outstanding?". The two diverge, and the gap is where a
        // fabricated absence gets in: a read overtaken by a newer request of
        // the SAME question is dropped without setting `data` or `error`, so a
        // flag tracking requests would report "not loading" over a question
        // coord has never answered, and this slot would render the plain "No
        // plans matching status=X." underneath a strip still reading "Waiting
        // for coord…". Derived from the answer instead, that state is what it
        // is — still waiting, so still skeletons.
        loaded={data !== null || error !== null}
        skeletonRows={6}
        empty={
          plansUnknown ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-unknown"
            >
              Could not read the work-unit list — whether any plan matches
              status={status === "any" ? "any" : status} is unknown, not none.
            </p>
          ) : plansStale ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-stale"
            >
              No plans matched status={status === "any" ? "any" : status} at the
              last good read — this list has not refreshed since.
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-empty"
            >
              No plans matching status={status === "any" ? "any" : status}.
            </p>
          )
        }
        renderRow={(p, ctx) => (
          <PlanRow plan={p} expanded={ctx.expanded} onToggle={ctx.onToggle} />
        )}
      />
    </div>
  );
}
