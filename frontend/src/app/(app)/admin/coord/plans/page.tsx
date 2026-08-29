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
 * - **R7** — the fetch-window caveats (truncation, missing creation dates)
 *   collapse into a `<CollapsiblePanel>` whose summary badge stays visible, so
 *   the warning cannot hide behind the click.
 *
 * **The status `<Select>` deliberately stays a Select, not `<FilterTabs>`.**
 * It is a SERVER-side filter — the value goes to coord as `?status=` and
 * changes what is fetched — so tab counts would be `–` for all nine options on
 * every render but one. R6's dash rule permits that; it would still be a
 * strictly worse control than the Select, and `coord-plans-status-select` is a
 * frozen authored testid (D4a). The counts operators actually want are in the
 * health strip, derived from the window that WAS fetched.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownUp, Filter, RefreshCw, TriangleAlert } from "lucide-react";
import {
  CollapsiblePanel,
  HealthStrip,
  RecordList,
  readIsUnknown,
} from "@/components/console";
import { PlanRow } from "@/components/admin/coord/PlanRow";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { httpClient } from "@/services/service-factory";
import { sortPlans, SORTS, type SortKey } from "./planSort";
import { derivePlansHealth } from "./plansHealth";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

/**
 * Ask for coord's maximum page.
 *
 * Sorting happens client-side, so the window we sort over is the window we
 * fetched. coord's list is `ORDER BY updated_at DESC LIMIT $3` with a default
 * of 100 and a hard clamp of 500 (`work_unit_registry.rs` `list_work_units`),
 * and the proxy forwards no sort parameter — so requesting the clamp is the
 * widest honest window available. When the result fills it, the corpus is
 * larger than what is sorted and the page says so; see `truncated` below.
 */
const FETCH_LIMIT = 500;

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

interface PlansListResponse {
  // coord `/coord/work-units` returns rows under `work_units`. `plans` is
  // kept for backwards-tolerance during the cutover (harmless if absent).
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
  limit?: number;
  offset?: number;
  count?: number;
}

export default function CoordPlansListPage() {
  const [status, setStatus] = useState("any");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [data, setData] = useState<PlansListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (status && status !== "any") qs.set("status", status);
      qs.set("limit", String(FETCH_LIMIT));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const body = await httpClient.get<PlansListResponse>(
        `${API}/plans${suffix}`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const plans = useMemo(
    () => data?.work_units ?? data?.plans ?? [],
    [data]
  );
  const sorted = useMemo(() => sortPlans(plans, sort), [plans, sort]);
  // coord returned a full page, so there are almost certainly more work units
  // than we sorted. Say so: with the list capped at `updated_at DESC`, an
  // "oldest created" answer drawn from this window can be wrong.
  const truncated = plans.length >= FETCH_LIMIT;
  const missingCreated = plans.filter((p) => !p.created_at).length;
  const loaded = data !== null;
  // R6 — "not fetched" includes "fetched and FAILED". The shared deriver grew
  // this arm for `/spawn`; this route reads the same list from the same
  // endpoint and had the same hole, so it consults it too.
  const readFailed = error !== null;
  const plansUnknown = readIsUnknown(loaded, readFailed);
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
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-plans-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* R7 — the window caveats are infrastructural, so they collapse; the
          summary badge keeps the signal visible while they are closed. */}
      {(truncated || missingCreated > 0) && (
        <CollapsiblePanel
          titleAs="h2"
          className="p-2.5"
          defaultOpen={false}
          storageKey="coord-plans-window-caveats"
          icon={<TriangleAlert className="h-3.5 w-3.5 text-amber-400" />}
          title="Fetch-window caveats"
          summary={
            <span className="text-xs text-amber-300/90 normal-case tracking-normal">
              {[
                truncated ? `capped at ${FETCH_LIMIT}` : null,
                missingCreated > 0 ? `${missingCreated} undated` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          }
          contentClassName="space-y-1"
          data-testid="coord-plans-window-caveats"
        >
          {truncated && (
            <p
              className="text-xs text-amber-300/90"
              data-testid="coord-plans-truncated-notice"
            >
              Showing the {FETCH_LIMIT} most-recently-updated work units — coord
              caps this list. Sorting applies to these only, so a
              &ldquo;{SORTS.find((s) => s.value === sort)?.label}&rdquo; result
              may not be the corpus-wide answer.
            </p>
          )}
          {missingCreated > 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-plans-missing-created-notice"
            >
              {missingCreated} of {plans.length} have no creation date recorded;
              they sort last rather than being treated as oldest.
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
        loaded={!(loading && !data)}
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
          <PlanRow
            plan={p}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
          />
        )}
      />
    </div>
  );
}
