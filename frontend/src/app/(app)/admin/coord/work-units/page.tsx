"use client";

/**
 * /admin/coord/work-units — list coord WORK UNITS, filter by status.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2);
 * repointed onto the generic work-unit primitive
 * (`2026-06-18-coord-generic-work-unit-primitive`).
 *
 * ## Why this page is no longer called "Plans" (Phase 3 of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store`)
 *
 * This page reads `coord.work_units` — the OPERATIONAL store — through
 * `/api/v1/operations/plans*`. Read as one `updated_at DESC` page clamped at
 * 500, that is a **recency window over coord's work units**, not the plan
 * corpus: a unit's position depends on when it was last touched, so work that
 * has stalled is exactly what falls out of view. Calling it "Plans" told an
 * operator it was a corpus they could search, and one who could not find a
 * three-week-old plan on it read "not here" as "absent".
 *
 * The plan CORPUS now lives at `/admin/coord/plans`, which reads
 * `GET /api/v1/plan-library/reconciliation` (slug-ordered, paged, with a
 * stated total). This page keeps the question it always actually answered —
 * *what is in coord's work-unit store, what has it touched lately, and what is
 * blocked?* — under the name of the store it reads. The recency view stays,
 * deliberately, as the "Recently updated" sorts (one `order=updated_desc`
 * page): for the merge-escalation triage this page is FOR, recency is the
 * right axis. The authored sorts WALK the store instead (next section), so an
 * operator sorting by authoring date sorts the whole store, not one window.
 *
 * **The `shepherd-*` exclusion is a control here, not a constant, and it
 * DEFAULTS TO INCLUDED.** `shepherd-*` units are coord's own unlandable-PR
 * merge escalations (`SHEPHERD_SLUG_PREFIX`, `plansHealth.tsx`). They were
 * hard-excluded while this route was called "Plans", which was right — they
 * are not plans. On a work-unit page they are the subject, and hard-excluding
 * them would leave ~1,264 rows with no consumer on either page. So the
 * exclusion is a Select, defaulting to including them, and the operator can
 * narrow to authored work when that is the question. It is a SERVER-side
 * parameter, so it goes in the walk's `baseParams` and rides on EVERY page of
 * a walk (`planWalk.ts` `pageUrl`), never on the first page alone.
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
 * Walking costs several reads where a slice cost one, so the POLL CADENCE is
 * per server order (`POLL_INTERVAL_MS`) — 120 s for a walked view, 10 s for the
 * single-page one — and a read stamp under the controls states when the list on
 * screen was read, in EVERY arm where a list is shown (it sits outside the
 * collapsible fetch-window panel, which renders only when there is a caveat).
 * What a complete walk can and cannot promise is `planWalk.ts`'s
 * `complete` docs; the panel says the same thing in the operator's words, and
 * the health strip declares itself computed over a partial list whenever it is
 * (`derivePlansHealth`'s `incomplete`).
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
 * strictly worse control than the Select, and `coord-work-units-status-select` is a
 * frozen authored testid (D4a). The counts operators actually want are in the
 * health strip, derived from the rows that WERE read.
 *
 * The shepherd Select follows that precedent for the same reason: it is also a
 * SERVER-side filter (`?exclude_slug_prefix=`), so a chip strip would carry
 * dashes rather than counts. Being server-side, it changes the population that
 * was READ rather than narrowing the rendered rows, so it is stated in the
 * fetch-window copy as part of what was read — not in `shownUnderFilter`,
 * which names only the client-side narrowings.
 *
 * ## Difficulty (plan `2026-09-18-plan-library-difficulty-field`)
 *
 * Each row carries the plan library's difficulty rating — the model tier the
 * plan routes to — read from `/api/v1/plan-library/difficulty` by
 * `usePlanDifficulty` and joined by slug (`planDifficulty.ts`). Unlike the
 * status Select, the difficulty Select is a CLIENT-side filter over the rows
 * that were READ, and it is disabled until the ratings have loaded: filtering
 * on ratings the page does not have would render an empty list that reads as
 * "no plan is that hard".
 *
 * **It needs nothing from the corpus walk, and that is a property of the
 * ratings read rather than a convenience.** `usePlanDifficulty` issues ONE
 * un-parameterised `GET /api/v1/plan-library/difficulty` — a whole-corpus map
 * (`crud.list_plan_difficulties` takes no LIMIT), on its own 5-minute cadence —
 * so there is no query parameter to put on each `pageUrl` and no per-request
 * envelope block to fold across pages the way `foldBodySignalBlocks` folds the
 * body signals. The join is `difficultyCell(index, slug)` per rendered row, so
 * a walk of four pages and a single page are the same case to it.
 *
 * What the walk DOES change is the honesty arithmetic: the filter narrows the
 * rendered list, so it is counted in `shownUnderFilter` beside the two body
 * strips (see there), while the fetch-window panel's own counts and the health
 * strip stay on the UNFILTERED `plans`.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDownUp,
  FileQuestion,
  Filter,
  ListChecks,
  ShieldAlert,
  SignalHigh,
  TriangleAlert,
} from "lucide-react";
import {
  CollapsiblePanel,
  FilterChips,
  HealthStrip,
  RecordList,
  RefreshButton,
  readIsUnknown,
} from "@/components/console";
import { PlanRow } from "@/components/admin/coord/PlanRow";
import { planAuthoredAt } from "@/components/admin/coord/planStatus";
import {
  HAS_BODY_FILTERS,
  PROVENANCE_FILTERS,
  filterPlansByBodySignal,
  hasBodyFilterTooltip,
  hasBodyFilterValue,
  type BodyProvenance,
  type HasBodyFilter,
} from "@/components/admin/coord/planBodySignal";
import {
  DIFFICULTY_FILTERS,
  difficultyCell,
  matchesDifficulty,
  type DifficultyFilter,
} from "@/components/admin/coord/planDifficulty";
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
  type OverviewTotal,
  type ServerOrder,
  type WalkOutcome,
  type WorkUnitOverview,
} from "./planWalk";
import { usePlanDifficulty } from "./usePlanDifficulty";
import {
  useGuardedPoll,
  type ReadGuard,
} from "@/components/admin/coord/useGuardedPoll";
import {
  derivePlansHealth,
  SHEPHERD_FILTERS,
  SHEPHERD_SLUG_PREFIX,
  type ShepherdFilter,
} from "./plansHealth";

const API = "/api/v1/operations";

/** What one row IS here — see `PlansHealthNoun` in `plansHealth.tsx`. */
const WORK_UNIT_NOUN = { one: "work unit", many: "work units" };

/** "1 work unit" / "N work units" — the overview sentences take any count. */
function workUnits(n: number): string {
  return `${n} work unit${n === 1 ? "" : "s"}`;
}

/** Which of coord's overview counts a status filter is compared against. */
function overviewScope(status: string): string {
  return status === "any" ? "in total" : `with status=${status}`;
}

/**
 * The gap between coord's overview total and the rows read, stated as a
 * direction and a size — never a signed number ("a difference of -3"), and
 * never with a cause attached: the two are separate reads, and a gap of any
 * size is reported rather than explained away.
 */
function describeGap(overviewTotal: number, read: number): string {
  const gap = overviewTotal - read;
  if (gap === 0) return "none";
  return gap > 0
    ? `${gap} more than this read`
    : `${-gap} fewer than this read`;
}

/**
 * Why there is no overview total to compare against — the two causes kept
 * apart (`overviewTotalFor`): an overview that never answered, and one that
 * answered without breaking out this question.
 */
function overviewMissSentence(
  miss: Exclude<OverviewTotal, { kind: "total" }>,
  status: string
): string {
  if (miss.kind === "unread") return "coord's overview could not be read";
  return status === "any"
    ? "coord's overview was read but carries no total"
    : `coord's overview was read but does not break out status=${status}`;
}

/**
 * The poll cadence, per SERVER ORDER — because the order is what decides
 * whether one tick costs one read or a whole walk.
 *
 * Before the corpus walk this page made ONE `limit=500` read per tick. The
 * walk makes ceil(N/500) SEQUENTIAL list reads instead, each a 500-row coord
 * read with a LATERAL sub-select per row, plus `/plans/overview` once.
 *
 * **And every page now pays a SECOND coord read of its own.** The body signals
 * (plan `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`)
 * are computed per request by the proxy: `_apply_body_signals` →
 * `_read_plan_capture_dial` → a `GET /coord/fleet-policy` proxy read, plus a
 * `resolve_body_knowledge` call against qontinui-web's own schema
 * (`operations.py`) that issues THREE queries of its own, not one —
 * `resolve_personal_organization`, `crud.count_artifacts` and
 * `crud.work_unit_slugs_with_artifacts` (`plan_body_signal.py`). So a P-page
 * walk costs 2P + 1 coord round trips (P list + P dial + 1 overview) and 3P
 * local DB queries.
 *
 * **The rule this cadence is held to:** the DEFAULT view's steady-state coord
 * read rate may not exceed what the single 500-row slice this plan REPLACED
 * cost on the same backend — one list read plus its dial read per 10 s tick,
 * ~12 coord reads a minute. The walk buys completeness; it may not pay for it
 * by multiplying the read rate.
 *
 * The corpus, as measured: the `shepherd-*` merge escalations were 1,264 rows
 * on 2026-09-20, 39% of `coord.work_units` (`plansHealth.tsx`) — so ~3.2k rows
 * in all, of which ~2.0k are not shepherd rows (~1.8k when first measured on
 * 2026-09-19). Under each setting of the shepherd control:
 *
 * - **include (the DEFAULT, and the setting that sets the bound)** — 7 pages:
 *   7 list + 7 dial + 1 overview = 15 coord reads and ~21 local DB queries per
 *   walk. At 60 s that was 15 coord reads a minute, ABOVE the ~12 baseline;
 *   an earlier revision of this comment priced the walk at 4 pages, which was
 *   only ever true of the non-shepherd set this route no longer defaults to.
 *   At 120 s it is 7.5 coord reads (~10.5 DB queries) a minute.
 * - **exclude** — 4 pages: 4 + 4 + 1 = 9 coord reads and ~12 DB queries per
 *   walk; 4.5 coord reads a minute at 120 s.
 *
 * 120 s holds the rule with room for the corpus to grow: the default view stays
 * at or under ~12 coord reads a minute up to 11 pages (2·11 + 1 = 23 reads per
 * two minutes), i.e. ~5.5k rows. Past that the arithmetic has to be redone.
 *
 * On a 10 s tick the default walk would be ~90 coord reads a minute per tab,
 * and `useGuardedPoll`'s in-flight lock is not a bound on it: it stops ticks
 * STACKING, so on a link where one walk takes longer than the interval the
 * steady state is back-to-back walks — continuous polling, which is what this
 * table exists to prevent.
 *
 * - `updated_desc` — one page by design, so one list read plus its dial read.
 *   Unchanged at 10 s: ~12 coord reads a minute — the baseline itself.
 * - `authored_desc` — a walk, at 120 s, per the arithmetic above.
 *
 * Freshness is not lost, only un-automated: `<RefreshButton>` is unthrottled,
 * so a current answer is one press away, and its `title` names the cadence
 * actually in force rather than a constant baked into the copy.
 *
 * Two deliberate imprecisions. A coord that PREDATES the walk answers one page
 * under `authored_desc` and still polls at 120 s — which arm answered is only
 * knowable after a read, and erring slow costs freshness, not correctness.
 * And the interval is derived from `order` (a property of the QUESTION) rather
 * than from the last outcome, which would put `data` in `read`'s dependency
 * set — and `read`'s identity is what `useGuardedPoll` re-asks the question
 * on. A cost knob must not be able to re-ask the question.
 */
const POLL_INTERVAL_MS: Record<ServerOrder, number> = {
  updated_desc: 10_000,
  authored_desc: 120_000,
};

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

/** Add or remove one value — the `FilterChips` caller owns the set. */
function toggle<V extends string>(prev: V[], value: V): V[] {
  return prev.includes(value)
    ? prev.filter((v) => v !== value)
    : [...prev, value];
}

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
  /**
   * When this answer was read, so a slower poll cadence (`POLL_INTERVAL_MS`)
   * cannot make the page silently present an old list as the current one.
   * Rendered unconditionally beside the list — not inside the conditional
   * fetch-window panel — and it is the read's clock, not coord's.
   */
  readAt: string;
}

const PARTIAL_REASON_COPY = {
  error: "a page read failed",
  page_cap: `it reached its ${WALK_MAX_PAGES}-page safety cap`,
  // Not "a cursor that did not advance": the walk stops on any cursor it has
  // already followed, including a longer cycle (`planWalk.ts` `cursorKey`).
  stalled: "coord repeated a cursor it had already handed out",
} as const;

export default function CoordWorkUnitsListPage() {
  const [status, setStatus] = useState("any");
  // Server-side, like `status` — see `SHEPHERD_FILTERS` in `plansHealth.tsx`
  // for why the default includes coord's own merge escalations.
  const [shepherd, setShepherd] = useState<ShepherdFilter>("include");
  const [sort, setSort] = useState<SortKey>("authored_desc");
  // Both body filters are CLIENT-side, unlike `status`: the proxy derives
  // these fields, it does not take them as query parameters, so there is
  // nothing to send per page and nothing a walk could drop. They filter the
  // rows that were READ — which, on a walked order, is the whole corpus under
  // the status filter rather than one 500-row slice. That also means their
  // counts are real — computed from the same rows the list renders — rather
  // than R6's `–`.
  const [provenance, setProvenance] = useState<BodyProvenance[]>([]);
  const [hasBody, setHasBody] = useState<HasBodyFilter[]>([]);
  // The difficulty filter is client-side for the same reason, but its ratings
  // come from a SECOND read (the plan library, not coord) — so unlike the body
  // signals it can be pending or failed, and the Select stays disabled until
  // it has loaded.
  const [difficultyFilter, setDifficultyFilter] =
    useState<DifficultyFilter>("any");
  const { index: difficultyIndex, refresh: refreshDifficulty } =
    usePlanDifficulty();
  const difficultyLoaded = difficultyIndex.state === "loaded";
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

  /** This view's tick — one read or a walk; see `POLL_INTERVAL_MS`. */
  const pollMs = POLL_INTERVAL_MS[order];

  /**
   * The guarded read, per `useGuardedPoll` — this page is the pattern it was
   * lifted from (a walk overtaken mid-way stops issuing pages via the same
   * `guard.isNewest`, exactly like the single-page read it replaced), so
   * migrating onto the shared hook changes no behaviour, only where the two
   * generation counters live.
   */
  const read = useCallback(
    async (guard: ReadGuard) => {
      try {
        const qs = new URLSearchParams();
        if (status && status !== "any") qs.set("status", status);
        // In `baseParams`, so it rides on every page of a walk — see the
        // module docstring. `include` sends nothing at all.
        if (shepherd === "exclude") {
          qs.set("exclude_slug_prefix", SHEPHERD_SLUG_PREFIX);
        }
        const outcome = await walkWorkUnits(
          (url) => httpClient.get(url),
          `${API}/plans`,
          qs,
          order,
          guard.isNewest
        );
        if (outcome === null || !guard.isNewest()) return;
        let overview: WorkUnitOverview | null = null;
        if (outcome.kind !== "single_page") {
          overview = await httpClient
            .get<WorkUnitOverview>(`${API}/plans/overview`)
            .catch(() => null);
          if (!guard.isNewest()) return;
        }
        setData({ outcome, overview, readAt: new Date().toISOString() });
        setError(null);
      } catch (e) {
        if (!guard.isCurrentQuestion()) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [status, shepherd, order]
  );

  // `status`, `shepherd` and the server `order` are `read`'s only
  // dependencies, so `useGuardedPoll` re-asks exactly when the QUESTION
  // changes. Dropping the previous window here is not cosmetic: `loaded` is
  // `data !== null`, so keeping it leaves every read-state derivation on this
  // page reporting the OLD query while the new one is in flight — the list
  // shows the previous filter's records instead of skeletons, the strip
  // describes the previous window, and a new fetch that FAILS lands on the
  // STALE arm ("the last counts that landed") when nothing has ever landed
  // for this query. That is R6's own `loaded`-means-"answered-THIS-question"
  // clause, one level up from a count.
  const onQuestionChange = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  const { refresh: guardedRefresh } = useGuardedPoll({
    read,
    intervalMs: pollMs,
    onQuestionChange,
  });

  /**
   * The refresh button's read — the operator's, never the poll's.
   *
   * The ratings refresh with the operator's press too — never with the poll
   * (see `usePlanDifficulty`) — and deliberately NOT via `useGuardedPoll`'s
   * `also`: that would fold it into the same lock and make `<RefreshButton>`
   * stay busy for whichever of the two reads is slower, when the button is
   * labelled for the work-unit read alone (plan
   * `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`
   * F1).
   */
  const refresh = useCallback(() => {
    void refreshDifficulty();
    return guardedRefresh();
  }, [guardedRefresh, refreshDifficulty]);

  const outcome = data?.outcome ?? null;
  const plans = useMemo(() => outcome?.rows ?? [], [outcome]);
  // The chip counts describe the ROWS THAT WERE READ, so they are derived from
  // `plans` — before the body filters are applied, or every count but the
  // selected one would collapse to 0 the moment a chip was clicked. What "the
  // rows that were read" means is the walk's business, not the filters':
  // on a `complete` walk it is the whole corpus under the status filter, and
  // on a `partial` one or a `single_page` it is less than that — which is why
  // the counts are never captioned as corpus-wide here. The fetch-window panel
  // and the health strip are the surfaces that qualify them.
  const provenanceCounts = useMemo(() => {
    const counts = new Map<BodyProvenance, number>();
    for (const p of plans) {
      if (p.body_provenance) {
        counts.set(p.body_provenance, (counts.get(p.body_provenance) ?? 0) + 1);
      }
    }
    return counts;
  }, [plans]);
  const hasBodyCounts = useMemo(() => {
    const counts = new Map<HasBodyFilter, number>();
    for (const p of plans) {
      const v = hasBodyFilterValue(p.has_body);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  }, [plans]);
  // A backend that predates the signals serves neither field. Offering a
  // filter over a vocabulary no row carries would let an operator select a
  // chip and empty the list — a control that can only ever answer "none" to a
  // question nobody was told the answer to.
  const bodySignalsServed = plans.some(
    (p) => p.body_provenance !== undefined || p.has_body !== undefined
  );
  const filtered = useMemo(
    () => filterPlansByBodySignal(plans, { provenance, hasBody }),
    [plans, provenance, hasBody]
  );
  const sorted = useMemo(() => sortPlans(filtered, sort), [filtered, sort]);
  const bodyFiltered = provenance.length > 0 || hasBody.length > 0;
  // The difficulty filter runs LAST, over the body-filtered rows, and only
  // once the ratings have loaded — see the module docstring.
  const shown = useMemo(
    () =>
      difficultyLoaded && difficultyFilter !== "any"
        ? sorted.filter((p) =>
            matchesDifficulty(
              difficultyCell(difficultyIndex, p.slug),
              difficultyFilter
            )
          )
        : sorted,
    [sorted, difficultyFilter, difficultyIndex, difficultyLoaded]
  );
  const difficultyFiltered = difficultyLoaded && difficultyFilter !== "any";
  /**
   * What is RENDERED, said only where it is actually being stated.
   *
   * Every count the fetch-window panel states of its own is PRE-FILTER —
   * `plans.length` in the complete and partial arms, `WALK_PAGE_LIMIT` in the
   * single-page one — taken before the client-side chip strips narrow them
   * (`filterPlansByBodySignal`), because the panel's subject is how much of
   * the corpus was READ, and a chip the operator clicked changes nothing about
   * that. Each of those sentences therefore says "read", never "shown": with a
   * chip selected the two differ, and FOUR sentences here have claimed the
   * pre-filter number was the number on screen — the fourth being the
   * single-page arm, which said "Showing" for one round longer than the
   * others. Where the rendered count is worth having it is the FILTERED one
   * and it is labelled as such; it is appended to all three arms, and is empty
   * unless a strip has a selection, since otherwise it is the same number
   * twice.
   *
   * The label names BOTH strips because {@link bodyFiltered} is either of
   * them: selecting only a scanner chip narrows the list exactly as a document
   * chip does, and calling that "the document filter" would attribute the
   * narrowing to a strip with nothing selected. The body-filtered empty state
   * below is worded the same way, deliberately — one phrasing, two places.
   *
   * **The DIFFICULTY select counts as a filter here for exactly the same
   * reason.** It is a third client-side narrowing over the same rows
   * (`shown`), so a rendered count taken before it — or a sentence omitted
   * because no chip was up — restates the pre-filter number as the number on
   * screen, which is the defect the whole paragraph above exists to close. The
   * count is therefore `shown.length` (what `<RecordList>` renders) and the
   * sentence appears whenever EITHER narrowing is in force, naming the ones
   * that are.
   */
  const renderedNarrowed = bodyFiltered || difficultyFiltered;
  const narrowingLabel = bodyFiltered
    ? difficultyFiltered
      ? "the document, scanner and difficulty filters"
      : "the document and scanner filters"
    : "the difficulty filter";
  const shownUnderFilter = renderedNarrowed
    ? ` ${shown.length} of them ${shown.length === 1 ? "is" : "are"} shown under ${narrowingLabel}.`
    : "";
  // A single page came back full (the "Recently updated" view, or a coord
  // that predates the walk), so there are almost certainly more work units
  // than are shown. Say so, and say which `updated_at` span they are.
  const truncated = outcome?.kind === "single_page" && outcome.truncated;
  const walkComplete = outcome?.kind === "complete";
  const walkPartial = outcome?.kind === "partial";
  /**
   * The rows on the page are KNOWN not to be the whole corpus — a walk that
   * stopped early, or a single page that came back full.
   *
   * This reaches the health strip, not just the fetch-window badge: counts
   * derived from part of a list are not a whole-corpus verdict, and "No plan is
   * blocked" off a partial read is the same over-claim in a louder place.
   */
  const listIncomplete = walkPartial || truncated;
  // The window's BOUNDARY (Phase 3 of plan
  // `2026-09-20-the-operator-plans-page-reads-the-wrong-store`): how far back
  // a truncated single page reaches, so "not here" can be told from "out of
  // window". Computed off `plans` — the rows READ — so a client-side sort or
  // filter cannot move a boundary it does not control. `null` = no row carries
  // a parseable `updated_at`: UNKNOWN, not "now".
  const updatedSpan = truncated ? timeSpan(plans, (p) => p.updated_at) : null;
  // The walk runs on coord's `authored_at` COLUMN, so that is the range a
  // partial walk covered — not the slug-derived date the chips show.
  const authoredSpan = walkPartial
    ? timeSpan(plans, (p) => p.authored_at)
    : null;
  const reachedUndatedTail = walkPartial && plans.some((p) => !p.authored_at);
  const shepherdExcluded = shepherd === "exclude";
  const coordTotal = overviewTotalFor(
    data?.overview ?? null,
    status,
    shepherdExcluded
  );
  /**
   * The server-side population the READ covered, beyond `status` — stated in
   * every arm of the fetch-window panel, because the shepherd control changes
   * what was read, not what is rendered (so it is not a `shownUnderFilter`
   * narrowing).
   */
  const shepherdScope = shepherdExcluded
    ? `excluding coord's ${SHEPHERD_SLUG_PREFIX}* merge escalations`
    : `including coord's ${SHEPHERD_SLUG_PREFIX}* merge escalations`;
  /**
   * The single page's DENOMINATOR, or UNKNOWN — never a substitute (Phase 3 of
   * plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`: *"a
   * disclosure without a denominator is a disclaimer, not a measurement"*).
   * `count` is deliberately NOT consulted: it is the size of the page, and
   * would render "500 of 500" over a window that is nothing of the sort.
   */
  const windowTotal = outcome?.kind === "single_page" ? outcome.total : null;
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
    // The noun is "work units", not "plans": with the shepherd filter
    // defaulting to INCLUDED these rows are coord's work units, and a badge
    // reading `plans 500` over them would be the mislabel this route was
    // moved to fix, restated in a badge. `plans` here is UNFILTERED — the
    // rows read, before any client-side chip or select narrows them.
    () =>
      derivePlansHealth(plans, loaded, readFailed, {
        noun: WORK_UNIT_NOUN,
        incomplete: listIncomplete,
        incompleteDetailsAt: "the fetch-window panel",
      }),
    [plans, loaded, readFailed, listIncomplete]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-work-units-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-work-units-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            className="w-[180px]"
            data-testid="coord-work-units-status-select"
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
        <ShieldAlert className="h-4 w-4 text-muted-foreground ml-1" />
        <Select
          value={shepherd}
          onValueChange={(v) => setShepherd(v as ShepherdFilter)}
        >
          <SelectTrigger
            className="w-[220px]"
            data-testid="coord-work-units-shepherd-select"
            title={
              "coord's own `shepherd-*` merge-escalation work units. They are " +
              "INCLUDED by default here — this page is the surface that " +
              "triages them, and no other page shows them at all. Excluding " +
              "them re-asks coord (`exclude_slug_prefix`) on every page of " +
              "the read; it does not filter the rows already read."
            }
          >
            <SelectValue placeholder="escalations" />
          </SelectTrigger>
          <SelectContent>
            {SHEPHERD_FILTERS.map((opt) => (
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
            data-testid="coord-work-units-sort-select"
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
        <SignalHigh className="h-4 w-4 text-muted-foreground ml-1" />
        <Select
          value={difficultyLoaded ? difficultyFilter : "any"}
          onValueChange={(v) => setDifficultyFilter(v as DifficultyFilter)}
          disabled={!difficultyLoaded}
        >
          <SelectTrigger
            className="w-[180px]"
            data-testid="coord-work-units-difficulty-select"
            title={
              difficultyIndex.state === "failed"
                ? `Difficulty ratings could not be read: ${difficultyIndex.reason}`
                : difficultyIndex.state === "pending"
                  ? "Difficulty ratings are loading"
                  : "Filter by the plan library's difficulty rating (applied to the rows fetched)"
            }
          >
            <SelectValue placeholder="difficulty" />
          </SelectTrigger>
          <SelectContent>
            {DIFFICULTY_FILTERS.map((opt) => (
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
          key={`${status}:${shepherd}:${order}`}
          onRefresh={refresh}
          label="Refresh work units"
          // Names the cadence ACTUALLY in force for this view, which is not a
          // constant: a walked order polls slowly on purpose
          // (`POLL_INTERVAL_MS`), and a press is the way to get a fresh answer
          // sooner than the tick.
          title={`Re-reads the work-unit list now; it also refreshes itself every ${pollMs / 1000} s`}
          data-testid="coord-work-units-refresh"
        />
      </div>

      {/* Does this "Plan" have a plan? Plan `2026-09-02-bodyless-work-units-…`.
          A second row rather than more controls on the first: these two answer
          a different question from status/sort, and the strips are only
          rendered at all once a backend has actually told us the answer. */}
      {bodySignalsServed && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="coord-work-units-body-filters"
        >
          <FileQuestion className="h-4 w-4 text-muted-foreground" />
          <FilterChips
            label="document"
            testIdPrefix="coord-work-units-has-body-filter"
            options={HAS_BODY_FILTERS.map((o) => ({
              ...o,
              count: hasBodyCounts.get(o.value) ?? 0,
            }))}
            selected={hasBody}
            onToggle={(v) => setHasBody((prev) => toggle(prev, v))}
            onClear={() => setHasBody([])}
            // The block is the FOLD of every page this answer was read over
            // (`planWalk.ts` `WalkCommon`, `foldBodySignalBlocks`), not the
            // first page's: a walk reads the dial once per page, so a miss on
            // any one of them is a miss this answer has to own — and the words
            // have to say WHICH. `hasBodyFilterTooltip` is worded off the
            // fold's `miss_scope`, so a miss on page 1 of 4 no longer speaks
            // for pages 2-4 — and BOTH of its arms scope the claim to the rows
            // a page could not match to a document, because a matched slug
            // settles `true` even on a page that missed. It also renders the
            // reason as the sentence every other surface uses rather than as
            // the wire enum an operator cannot read.
            title={hasBodyFilterTooltip(outcome?.bodySignal)}
          />
          <FilterChips
            label="scanner"
            testIdPrefix="coord-work-units-provenance-filter"
            options={PROVENANCE_FILTERS.map((o) => ({
              ...o,
              count: provenanceCounts.get(o.value) ?? 0,
            }))}
            selected={provenance}
            onToggle={(v) => setProvenance((prev) => toggle(prev, v))}
            onClear={() => setProvenance([])}
            title={
              "Whether a plan scanner has ever seen a file for this work " +
              "unit. A SCREEN, not a verdict — measured 2026-09-02 on one " +
              "device it has 27.6% precision and 90.4% recall."
            }
          />
        </div>
      )}

      {/* R7 — the window caveats are infrastructural, so they collapse; the
          summary badge keeps the signal visible while they are closed. */}
      {(truncated || walkComplete || walkPartial || missingAuthored > 0) && (
        <CollapsiblePanel
          titleAs="h2"
          className="p-2.5"
          defaultOpen={false}
          storageKey="coord-work-units-window-caveats"
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
                // `read*`, not `shown` — the panel is `defaultOpen={false}`, so
                // this summary is the part EVERY operator sees while the one
                // bound a keyset walk cannot close (a row re-dated mid-walk;
                // `planWalk.ts`' `complete` docs) sits behind the disclosure.
                // An unqualified "all N shown" is therefore the whole-corpus
                // claim being made in the only place that is always on screen.
                // "read" states what the walk did rather than what the corpus
                // is, and the `*` points at the caveat the open panel spells
                // out under the same marker.
                //
                // The partial arm says "read" for a SECOND reason on top of
                // that one: these counts are pre-filter (`plans`, not
                // `sorted`), so with a document chip selected "N shown" was
                // false about the page in front of the operator as well as
                // about the corpus.
                walkComplete ? `all ${plans.length} read*` : null,
                walkPartial ? `INCOMPLETE — ${plans.length} read` : null,
                truncated ? `capped at ${WALK_PAGE_LIMIT}` : null,
                missingAuthored > 0 ? `${missingAuthored} undated` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          }
          contentClassName="space-y-1"
          data-testid="coord-work-units-window-caveats"
        >
          {outcome?.kind === "complete" && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-work-units-walk-complete"
            >
              All {plans.length} work unit{plans.length === 1 ? "" : "s"}{" "}
              matching status={statusLabel} ({shepherdScope}){" "}
              {plans.length === 1 ? "was" : "were"} READ — the whole list, in
              authoring order ({outcome.pages} page
              {outcome.pages === 1 ? "" : "s"}).{shownUnderFilter}{" "}
              {/* Whether the overview and the walk are over the SAME set is the
                  shepherd control's to say: the overview takes no filters, so
                  it counts shepherd rows always, and the walk counts them only
                  under the default "include". */}
              {coordTotal.kind === "total"
                ? coordTotal.includesExcluded
                  ? `coord's overview counts ${workUnits(coordTotal.total)} ${overviewScope(
                      status
                    )}, INCLUDING its ${SHEPHERD_SLUG_PREFIX}* records, which this read excluded — so the two totals are measured over different sets, and the difference between them (${describeGap(
                      coordTotal.total,
                      plans.length
                    )}) is not by itself a count of missing work units.`
                  : coordTotal.total === plans.length
                    ? `coord's overview counts the same ${workUnits(coordTotal.total)} ${overviewScope(
                        status
                      )}, over the same set.`
                    : `coord's overview counts ${workUnits(coordTotal.total)} ${overviewScope(
                        status
                      )} over the same set — ${describeGap(
                        coordTotal.total,
                        plans.length
                      )}. The two are separate reads taken moments apart, and this page cannot tell which of them the difference lies in; reload to re-check.`
                : `${overviewMissSentence(coordTotal, status)}, so this count is not cross-checked.`}{" "}
              {/* The one thing a keyset walk cannot promise, said plainly
                  rather than left for the reader to work out: the walk orders
                  by `authored_at`, and coord heals a NULL one on the row's next
                  upsert while the plan scanner re-upserts about once a minute,
                  so a row can move behind the cursor mid-walk. See
                  `planWalk.ts`'s `complete` docs. The leading `*` resolves the
                  marker on the collapsed summary's `all N read*`. */}
              * A work unit whose authoring date changed while the list was
              being read can be missed; reload to re-check.
            </p>
          )}
          {outcome?.kind === "partial" && (
            <p
              className="text-xs text-amber-300/90"
              data-testid="coord-work-units-walk-partial"
            >
              INCOMPLETE — this list is NOT the whole corpus. {plans.length}{" "}
              work unit{plans.length === 1 ? " was" : "s were"} read (
              {shepherdScope})
              {authoredSpan
                ? `, with authored_at ${formatInstant(authoredSpan.newest)} back to ${formatInstant(authoredSpan.oldest)}`
                : ""}
              {reachedUndatedTail
                ? ", plus some with no authored_at in coord"
                : ""}
              ; the walk stopped after {outcome.pages} page
              {outcome.pages === 1 ? "" : "s"} because{" "}
              {PARTIAL_REASON_COPY[outcome.reason]}
              {outcome.error ? ` (${outcome.error})` : ""}.{" "}
              {/* "authored_at in coord", not "authoring date": the walk's
                  keyset runs on coord's `authored_at` COLUMN, so that is what
                  bounds where it reached — but everywhere else on this page an
                  "undated" row means no slug date AND no column
                  (`missingAuthored`), and the row chips show slug-derived
                  dates. Naming the column keeps this sentence from calling
                  rows "undated" whose chips show a date. */}
              {reachedUndatedTail
                ? "Every work unit with an authored_at in coord was reached; ones with none, further along the list, are missing from this page."
                : "Work units with an earlier authored_at, and every one with no authored_at in coord, are missing from this page."}
              {coordTotal.kind === "total"
                ? ` coord's overview counts ${workUnits(coordTotal.total)} ${overviewScope(
                    status
                  )}${
                    coordTotal.includesExcluded
                      ? ` (including its ${SHEPHERD_SLUG_PREFIX}* records, which this read excluded).`
                      : "."
                  }`
                : ` ${overviewMissSentence(coordTotal, status)}, so there is no coord total to set this against.`}
              {shownUnderFilter}
            </p>
          )}
          {outcome?.kind === "single_page" && truncated && (
            <p
              className="text-xs text-amber-300/90"
              data-testid="coord-work-units-truncated-notice"
            >
              {/* "Showing" was the fourth rendered-count claim over a
                  pre-filter number, and the one the "read, never shown" pass
                  missed: with a chip selected this arm said it was SHOWING 500
                  rows while 3 were on screen. It reads the cap rather than
                  `plans.length` because the claim is about the read, and
                  `shownUnderFilter` carries the rendered count here as it does
                  in the other two arms. */}
              The {WALK_PAGE_LIMIT} most-recently-updated work units were READ,
              of{" "}
              {windowTotal !== null ? (
                <>{windowTotal} matching this question</>
              ) : (
                <>
                  an <strong>unknown</strong> total — coord&apos;s work-unit
                  list envelope carries no count, so how much of the store this
                  is cannot be stated
                </>
              )}{" "}
              ({shepherdScope}).{" "}
              {updatedSpan !== null ? (
                <>
                  The rows read were updated{" "}
                  <span data-testid="coord-work-units-window-boundary">
                    {formatInstant(updatedSpan.oldest)}
                  </span>{" "}
                  to {formatInstant(updatedSpan.newest)}; anything untouched
                  since the first of those is out of the window, not absent.
                </>
              ) : (
                <span data-testid="coord-work-units-window-boundary">
                  No row in this window carries a readable updated_at, so how
                  far back it reaches is unknown.
                </span>
              )}
              {shownUnderFilter}{" "}
              {outcome.legacyCoord
                ? "This coord predates the authored-order walk, so it caps the list at one page by update time."
                : "“Recently updated” is a single page by design; choose an authored sort to read the whole list."}{" "}
              Sorting applies to these only, so a &ldquo;
              {SORTS.find((s) => s.value === sort)?.label}&rdquo; result may not
              be the corpus-wide answer. The plan corpus, slug-ordered with a
              stated total, is at /admin/coord/plans.
            </p>
          )}
          {missingAuthored > 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-work-units-missing-authored-notice"
            >
              {missingAuthored} of {plans.length} have no authoring date — no
              date prefix on the slug and no authored_at in coord; they sort
              last rather than being treated as oldest.
            </p>
          )}
        </CollapsiblePanel>
      )}

      {/* WHEN this list was read, and how often it re-reads itself. A walked
          order ticks every two minutes rather than every 10 s
          (`POLL_INTERVAL_MS`), which is only honest if the page says how old
          the answer on screen may be.

          **Outside the fetch-window panel, and gated on `data` alone.** It
          used to live INSIDE that panel, which renders only when there is a
          caveat to state (`truncated || walkComplete || walkPartial ||
          missingAuthored > 0`) — so a reachable arm dropped the stamp
          entirely: an authored sort (walked cadence) against a coord that
          PREDATES the walk, over a corpus under `WALK_PAGE_LIMIT` rows, is
          `single_page` with `truncated` false and no undated rows, and nothing
          on the page then said when the list was read or how seldom it
          re-reads. A 59-second-old list presented as current is the
          defect the cadence change was supposed to avoid, so the stamp is
          unconditional on a loaded list and the panel is free to be
          conditional. */}
      {data && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-work-units-read-at"
        >
          Read {formatInstant(data.readAt)}; this view re-reads itself every{" "}
          {pollMs / 1000} s. Press Refresh for a current answer.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {difficultyIndex.state === "failed" && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-work-units-difficulty-unknown"
        >
          Difficulty ratings could not be read ({difficultyIndex.reason}) — each
          row&apos;s difficulty is unknown, not unrated.
        </p>
      )}
      {difficultyIndex.state === "loaded" && difficultyIndex.staleReason && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-work-units-difficulty-stale"
        >
          Some difficulty ratings may predate the current rubric — re-rating
          failed: {difficultyIndex.staleReason}
        </p>
      )}

      <RecordList
        items={shown}
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
          // ORDER MATTERS. A client-side filter that emptied the list is a
          // statement about the ROWS THAT WERE READ — rows did arrive — so it
          // is checked BEFORE the unknown/stale copy, which is about the
          // work-unit read and would blame the wrong control. Difficulty
          // first, then the document filters, because difficulty runs over
          // their output.
          difficultyFiltered && sorted.length > 0 ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-work-units-difficulty-empty"
            >
              {/* `sorted` is counted AFTER the document and scanner chips, so
                  it is the rows READ only when neither strip has a selection —
                  the same read/shown rule as `shownUnderFilter`. "fetched"
                  called a filtered count the read. */}
              {`None of the ${sorted.length} work unit${
                sorted.length === 1 ? "" : "s"
              } ${
                bodyFiltered
                  ? "left by the document and scanner filters"
                  : "read"
              } is ${
                difficultyFilter === "unrated"
                  ? "unrated"
                  : `rated ${difficultyFilter}`
              }.`}
            </p>
          ) : bodyFiltered && plans.length > 0 ? (
            // The body filters are client-side, so "nothing matched" here is a
            // statement about the ROWS THAT WERE READ, not about coord. Saying
            // "No plans matching status=any" over a read that holds
            // {plans.length} rows would blame the wrong control. How much of
            // the corpus those rows ARE is the WALK's claim, not this
            // control's, so the sentence defers to `walkComplete` instead of
            // asserting one or the other on its behalf: "window" was exactly
            // right when this page only ever read one, and would be a fresh
            // understatement the moment a complete walk made it the corpus.
            // It names both strips for the same reason `shownUnderFilter`
            // does — `bodyFiltered` is either of them, so "the document
            // filter" alone would credit the narrowing to a strip that may
            // have nothing selected.
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-work-units-body-filtered-empty"
            >
              {plans.length === 1
                ? "The one work unit"
                : `None of the ${plans.length} work units`}{" "}
              {walkComplete ? "read — the whole list —" : "in this window"}{" "}
              {plans.length === 1 ? "does not match" : "match"} the document and
              scanner filters.
            </p>
          ) : plansUnknown ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-work-units-unknown"
            >
              Could not read the work-unit list — whether any work unit matches
              status={status === "any" ? "any" : status} is unknown, not none.
            </p>
          ) : plansStale ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-work-units-stale"
            >
              No work units matched status={status === "any" ? "any" : status}{" "}
              at the last good read — this list has not refreshed since.
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-work-units-empty"
            >
              No work units matching status={status === "any" ? "any" : status}
              {shepherd === "exclude"
                ? ", excluding coord's merge escalations."
                : "."}
            </p>
          )
        }
        renderRow={(p, ctx) => (
          <PlanRow
            plan={p}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            difficulty={difficultyCell(difficultyIndex, p.slug)}
          />
        )}
      />
    </div>
  );
}
