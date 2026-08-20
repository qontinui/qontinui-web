"use client";

/**
 * /admin/coord/history — shipped + archived plans (last 50 of each).
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * MVP shape: filter `coord.plans` by status in {shipped, archived};
 * future expansion adds recent merges + PR landings via coord's
 * merge_proposals + claims_audit tables. Two parallel fetches kept
 * separate so each section degrades independently.
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the three page-level `<Card><CardHeader><CardTitle>` wrappers are
 *   gone (one for the page blurb, one per section). `coord/layout.tsx` already
 *   renders the console `<h1>` and the nav crumb.
 * - **R1** — a `<HealthStrip>` derived from the two lists ALREADY FETCHED
 *   opens the page. No third request.
 * - **R6** — the two sections become `<FilterTabs>` with live counts. This is
 *   the shape R6 exists for: two meaningful subsets, both counts genuinely
 *   known, and an unfetched one renders `–` rather than `0`.
 * - **R2/R5** — one plan is one `<PlanRow>` line (shared with `/plans`);
 *   detail expands in place instead of the card being a whole-row `<Link>`.
 *
 * **Both fetches still run, on their original 30s cadence** (D5 — no poll
 * change rides along). Switching tabs changes which list is *rendered*, never
 * which is fetched: the counts on both tabs have to be true at the same time,
 * and a tab whose count came from a fetch that only fires when you click it
 * would be exactly the lie R6's dash rule forbids.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import { PlanRow } from "@/components/admin/coord/PlanRow";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

type SectionId = "shipped" | "archived";

const SECTION_LABEL: Record<SectionId, string> = {
  shipped: "Shipped",
  archived: "Archived",
};

interface SectionState {
  plans: CoordPlanRow[];
  /** Null until a SUCCESSFUL answer commits — `–`, never `0`, before that (R6). */
  count: number | null;
  /**
   * True once a request has SETTLED, success or failure. Distinct from
   * `count !== null` on purpose: a failed fetch leaves the count unknown
   * (so the tab still reads `–`) but the list must stop rendering skeletons,
   * because "we are still loading" would be a second thing that is not true.
   */
  settled: boolean;
  error: string | null;
}

const EMPTY_SECTION: SectionState = {
  plans: [],
  count: null,
  settled: false,
  error: null,
};

/**
 * One section's fetch + poll, hoisted OUT of a per-section component.
 *
 * It used to live in a `<HistorySection>` that rendered its own `<Card>`. The
 * counts now have to be visible on both tabs at once — which means both
 * sections' data has to live above the tab strip, not inside whichever section
 * happens to be rendered.
 */
function useSection(status: SectionId): SectionState & { refetch: () => void } {
  const [state, setState] = useState<SectionState>(EMPTY_SECTION);

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      qs.set("status", status);
      qs.set("limit", "50");
      const body = await httpClient.get<{ plans?: CoordPlanRow[] }>(
        `${API}/plans?${qs.toString()}`
      );
      const plans = body.plans ?? [];
      setState({ plans, count: plans.length, settled: true, error: null });
    } catch (e) {
      setState((prev) => ({
        ...prev,
        settled: true,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [status]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}

export default function CoordHistoryPage() {
  const shipped = useSection("shipped");
  const archived = useSection("archived");
  const [active, setActive] = useState<SectionId>("shipped");

  const current = active === "shipped" ? shipped : archived;

  // R1 — derived from the rows already on the page. There is no third fetch
  // and there cannot be: every number below is read off the two lists above.
  const health = useMemo(() => {
    const errors = [
      shipped.error ? "shipped" : null,
      archived.error ? "archived" : null,
    ].filter(Boolean) as string[];
    const bothIn = shipped.count !== null && archived.count !== null;

    const level: HealthStripLevel =
      errors.length > 0 ? "red" : bothIn ? "green" : "amber";
    const headline =
      errors.length > 0
        ? `coord did not answer for ${errors.join(" and ")}`
        : !bothIn
          ? "Waiting for coord…"
          : shipped.count === 0 && archived.count === 0
            ? "No shipped or archived plans in this window"
            : `${shipped.count} shipped, ${archived.count} archived`;
    const detail =
      errors.length > 0
        ? "the counts below cover only the half that answered"
        : "the 50 most recent of each — this is a window, not the corpus";

    const badges: HealthBadge[] = [
      {
        key: "shipped",
        // `count` is null until the first answer commits, and `–` is what
        // that renders as — never `0`, which would claim we looked.
        label: <>shipped {shipped.count ?? "–"}</>,
        tone: "muted",
      },
      {
        key: "archived",
        label: <>archived {archived.count ?? "–"}</>,
        tone: "muted",
      },
    ];
    return { level, headline, detail, badges };
  }, [shipped.count, shipped.error, archived.count, archived.error]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-history-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-history-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs<SectionId>
          tabs={[
            { id: "shipped", label: SECTION_LABEL.shipped, count: shipped.count },
            {
              id: "archived",
              label: SECTION_LABEL.archived,
              count: archived.count,
            },
          ]}
          active={active}
          onChange={setActive}
          // Yields `coord-history-shipped` / `coord-history-archived` — the two
          // testids the section `<Card>`s carried, on the control that now
          // selects the same section (D4a).
          testIdPrefix="coord-history"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={current.refetch}
          data-testid="coord-history-refresh"
          aria-label={`Refresh ${SECTION_LABEL[active].toLowerCase()} plans`}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {current.error && (
        <p className="text-sm text-destructive">
          Failed to load: {current.error}
        </p>
      )}

      <RecordList
        // Keyed on the active tab so switching REMOUNTS the list. Without it
        // the internal `expandedKey` survives the switch, and a slug present
        // in both windows (a plan can be shipped AND later archived) would
        // appear already-expanded in a tab the operator has not touched.
        key={active}
        items={current.plans}
        itemKey={(p) => p.slug}
        // Settled, not "counted": a failed fetch must stop the skeletons even
        // though its count stays unknown.
        loaded={current.settled}
        skeletonRows={6}
        renderRow={(p, ctx) => (
          <PlanRow plan={p} expanded={ctx.expanded} onToggle={ctx.onToggle} />
        )}
        empty={
          current.error ? (
            // Gated on `error`: asserting "no shipped plans" on a request that
            // never answered is the empty-is-not-unknown mistake. The failure
            // message above is the honest rendering.
            null
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No {active} plans in the last 50.
            </p>
          )
        }
      />
    </div>
  );
}
