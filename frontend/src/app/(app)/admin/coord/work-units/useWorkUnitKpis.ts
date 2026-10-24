"use client";

/**
 * The work-unit KPIs, for `/admin/coord/work-units` and
 * `/admin/coord/work-units/[slug]`: ONE read of `GET /api/v1/operations/kpis`
 * for the visible window, indexed by slug — never one read per row.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. A SECOND read beside
 * the page's work-unit list, and deliberately not on its poll: KPIs move when a
 * unit ships or a usage row lands, not every ten seconds, and the composer
 * walks every shipped unit of the window. So it reads once on mount, again
 * when the window changes (a different question), and when the operator presses
 * refresh — the same cadence rule `usePlanDifficulty` follows for its ratings.
 *
 * ## Failure is a state, not zeros
 *
 * The coord route may not exist yet (Phase 3 deploys separately), may time out,
 * or may answer in a shape this build cannot read. Each of those lands as
 * `{state: "unavailable", reason}`: the pages then print "KPIs unavailable" and
 * NO figure. A failed RE-read over a good one keeps the good one and records
 * `staleReason` — a failure is evidence about the network, not about the
 * figures, and blanking them would turn a blip into a page of unknowns.
 *
 * Single-flight and no retries (`COORD_DASHBOARD_POLL_OPTIONS`): one request per
 * read, and a superseded read's answer is dropped rather than landed under the
 * wrong question.
 *
 * ## Two questions, one hook
 *
 * - `{window}` — the LIST page's: the shipped units of that window, one read for
 *   every row.
 * - `{slug}` — the `[slug]` page's: coord is asked for THAT unit
 *   (`?slug=<slug>`), which it returns whatever its status and wherever it sits
 *   relative to a window. So an empty `units` is coord saying it has no KPI row
 *   for the unit — "no KPIs recorded" — and there is no "outside the window"
 *   question left to be unsure about. A slug read sends no `window`: the unit's
 *   figures do not depend on one, and the aggregates coord also computes are not
 *   rendered here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isKpisPayload } from "@/components/admin/coord/kpisV1";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "@/components/operations/coordPollError";
import {
  KPIS_SCHEMA_MISMATCH_REASON,
  KPI_PENDING,
  indexKpis,
  type KpiIndex,
} from "@/components/admin/coord/workUnitKpis";
import { fetchKpis } from "@/lib/api/operations/coordKpis";

/** The wording for a coord that does not serve the route (404/405/501). */
export const KPIS_ROUTE_UNAVAILABLE_TEXT =
  "coord does not serve work-unit KPIs yet (GET /coord/kpis)";

/** Why a slug read answered with a different unit is "unavailable", not "no row". */
export const KPIS_SLUG_MISMATCH_REASON =
  "coord answered a request for one work unit with a different one";

/** What to ask coord. Exactly one of the two is meaningful per page. */
export interface KpiReadQuery {
  /** The list page: coord's `28d` grammar. */
  window?: string;
  /** The `[slug]` page: the one work unit to ask for. */
  slug?: string;
}

export interface UseWorkUnitKpisResult {
  index: KpiIndex;
  /** Re-reads now. Resolves when that read has landed (or failed). */
  refresh: () => Promise<void>;
}

export function useWorkUnitKpis(query: KpiReadQuery): UseWorkUnitKpisResult {
  const kpiWindow = query.window;
  const kpiSlug = query.slug;
  // The question as one comparable key. Held WITH the answer, so a changed
  // question reads as `pending` without a reset effect: a different window's
  // (or another unit's) figures are never shown under this one's heading.
  const key = `${kpiWindow ?? ""}|${kpiSlug ?? ""}`;
  const [held, setHeld] = useState<{ key: string; index: KpiIndex }>({
    key,
    index: KPI_PENDING,
  });
  /** Generation counter: a read whose number is stale lands nothing. */
  const generation = useRef(0);

  const read = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const body = await fetchKpis(
        { window: kpiWindow, slug: kpiSlug },
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (mine !== generation.current) return;
      if (!isKpisPayload(body)) {
        setHeld({
          key,
          index: { state: "unavailable", reason: KPIS_SCHEMA_MISMATCH_REASON },
        });
        return;
      }
      // An empty `units` for a slug read is how coord says "no row for it", so
      // it may only be believed when `units` is otherwise what was asked for:
      // another unit's row in the answer is a malformed reply, not an absence.
      if (kpiSlug !== undefined && body.units.some((u) => u.slug !== kpiSlug)) {
        setHeld({
          key,
          index: {
            state: "unavailable",
            reason: KPIS_SLUG_MISMATCH_REASON,
          },
        });
        return;
      }
      setHeld({
        key,
        index: indexKpis(body, new Date().toISOString(), null, kpiSlug ?? null),
      });
    } catch (e) {
      if (mine !== generation.current) return;
      const reason = describeCoordPollError(e, {
        routeUnavailableText: KPIS_ROUTE_UNAVAILABLE_TEXT,
      });
      setHeld((prev) =>
        prev.key === key && prev.index.state === "loaded"
          ? { key, index: { ...prev.index, staleReason: reason } }
          : { key, index: { state: "unavailable", reason } }
      );
    }
  }, [key, kpiWindow, kpiSlug]);

  useEffect(() => {
    void read();
    return () => {
      // Unmount or a new question: whatever is still out must not land. A
      // counter, not a DOM node — the "will have changed" the rule guards
      // against is exactly what this bump relies on.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [read]);

  return {
    index: held.key === key ? held.index : KPI_PENDING,
    refresh: read,
  };
}
