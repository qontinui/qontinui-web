"use client";

/**
 * /admin/coord/spawn — the operator's spawn surface. TWO entry points:
 *
 *  1. **New session** (unanchored) — the header button opens `SpawnModal`
 *     with NO plan seeded. The operator picks a machine, names at least one
 *     repo, writes a prompt, and submits. Nothing invents a plan slug: the
 *     anchor keys are omitted from the wire body entirely, so the resulting
 *     `coord.sessions` row has a NULL `work_unit_slug` and appears under no
 *     plan. Plan
 *     `2026-08-25-general-purpose-session-spawn-machine-account-prompt`
 *     Phase 1.
 *  2. **Spawn from plan** (anchored) — the per-row button below, which
 *     opens the same modal pre-seeded with that plan's slug +
 *     current_phase.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4)
 * built the anchored half; the plan list below mirrors
 * `/admin/coord/plans` (the canonical plan registry).
 *
 * The two lists are deliberately independent — a plan can exist with no
 * session and a session can run with no plan — so the unanchored spawn is a
 * normal state here, not an exception.
 *
 * The plans list is read-only here (cross-link to /admin/coord/plans
 * for transition / history actions). This page exists to make the
 * spawn flow obvious and one-click — the same affordance exists as a
 * per-row button on the Plans page, but having a dedicated tab in
 * CoordNav means the spawn flow is at most one click from anywhere.
 *
 * ## Console style (Phase 3 Wave 3)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Spawn from plan`
 *   wrapper is gone; `coord/layout.tsx` already renders the console `<h1>`.
 *   The body is now `p-3 sm:p-6 space-y-4` (it was a flat `p-6`).
 * - **R1** — a `<HealthStrip>` opens the page, derived from the rows this page
 *   ALREADY fetched. It reuses `/plans`' `derivePlansHealth` rather than
 *   forking a second reading of the same work-unit list — the two routes read
 *   the same endpoint and must not disagree about whether a plan is blocked.
 * - **R2/R5** — one work unit is one `<SpawnPlanRow>` line; detail expands in
 *   place, and `<RecordList>` keeps one open at a time.
 *
 * The UNANCHORED spawn control (`coord-spawn-new-session-button`) predates this
 * migration and survives it: R9 deleted the `<CardTitle>` that used to host it,
 * so it moved into the filter row, right-aligned. It is the only way to spawn a
 * session under no plan, so dropping it with the card would have been a silent
 * feature regression — the filter-row prose carries its explanation too.
 *
 * **The status `<Select>` deliberately stays a Select, not `<FilterTabs>`** —
 * the same reason `/plans` gives: it is a SERVER-side filter (`?status=` goes
 * to coord and changes what is fetched), so every tab but the active one would
 * carry `–` forever. R6's dash rule permits that and it would still be a
 * strictly worse control. `coord-spawn-status-select` is also a frozen
 * authored testid (D4a).
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
import { Filter, Plus, RefreshCw } from "lucide-react";
import { HealthStrip, RecordList, readIsUnknown } from "@/components/console";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { SpawnModal } from "@/components/admin/coord/SpawnModal";
import { SpawnPlanRow } from "@/components/admin/coord/SpawnPlanRow";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { httpClient } from "@/services/service-factory";
import { derivePlansHealth } from "../plans/plansHealth";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 15_000;

const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "drafted", label: "Drafted" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
];

interface PlansListResponse {
  // `/operations/plans` now proxies coord work-units (envelope
  // `{work_units: [...]}`); `plans` kept for cutover tolerance.
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
}

export default function CoordSpawnPage() {
  const [status, setStatus] = useState("in_progress");
  const [data, setData] = useState<PlansListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [spawnTarget, setSpawnTarget] = useState<CoordPlanRow | null>(null);
  /** Unanchored spawn — the modal opens with no plan seeded at all. Kept
   *  as its own flag rather than a sentinel `spawnTarget`, so nothing can
   *  mistake it for a plan row with an empty slug. */
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (status && status !== "any") qs.set("status", status);
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
    // Same reset as `/plans`, for the same reason and against the same
    // `derivePlansHealth`: `status` is `fetchData`'s only dependency, so a
    // re-run means the QUESTION changed, and the retained rows answer the old
    // one. Left in place they keep `loaded` true across the change, so the
    // list renders the previous filter's plans as this filter's answer and a
    // failed first read under the new filter is reported as stale rather than
    // unknown. Not in `fetchData` — the poll calls that, and a poll must never
    // blank a loaded page.
    setData(null);
    setError(null);
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const plans = useMemo(() => data?.work_units ?? data?.plans ?? [], [data]);
  const loaded = data !== null;
  // R6 — "not fetched" includes "fetched and FAILED", and every surface derived
  // from the list has to consult it, the `empty=` slot included.
  const readFailed = error !== null;
  const plansUnknown = readIsUnknown(loaded, readFailed);
  const health = useMemo(
    () => derivePlansHealth(plans, loaded, readFailed),
    [plans, loaded, readFailed]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-spawn-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-spawn-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            className="w-[180px]"
            data-testid="coord-spawn-status-select"
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
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-spawn-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
        <CoordAdminOnly>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setNewSessionOpen(true)}
            data-testid="coord-spawn-new-session-button"
          >
            <Plus className="h-3 w-3 mr-1" />
            New session
          </Button>
        </CoordAdminOnly>
        <span className="basis-full text-xs text-muted-foreground">
          Pick a plan, hit Spawn, fill in device + repos + intent + the initial
          prompt. Coord acquires claims and ships the prompt on first tick. No
          plan? <span className="font-medium">New session</span> spawns an
          unanchored agent — a machine, at least one repo (coord derives the
          tenant and the worktree from it) and a prompt. It is listed on{" "}
          <span className="font-mono">/sessions</span> and under no plan.
        </span>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <div data-testid="coord-spawn-plans-list">
        <RecordList
          items={plans}
          itemKey={(p) => p.slug}
          loaded={!(loading && !data)}
          skeletonRows={6}
          empty={
            plansUnknown ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-spawn-plans-unknown"
              >
                Could not read the work-unit list — whether any plan matches
                status={status === "any" ? "any" : status} is unknown, not none.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-spawn-plans-empty"
              >
                No plans matching status={status === "any" ? "any" : status}.
              </p>
            )
          }
          renderRow={(p, ctx) => (
            <SpawnPlanRow
              plan={p}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              onSpawn={() => setSpawnTarget(p)}
            />
          )}
        />
      </div>

      {spawnTarget && (
        <SpawnModal
          open={spawnTarget !== null}
          onClose={() => setSpawnTarget(null)}
          planSlug={spawnTarget.slug}
          initialPhase={spawnTarget.current_phase ?? ""}
        />
      )}

      {newSessionOpen && (
        // No `planSlug` — the prop is optional and its absence is what makes
        // the spawn unanchored. Passing `""` would be the same thing to the
        // modal, but naming the omission keeps the intent readable.
        <SpawnModal
          open={newSessionOpen}
          onClose={() => setNewSessionOpen(false)}
        />
      )}
    </div>
  );
}
