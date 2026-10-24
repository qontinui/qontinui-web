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
 * wrong window.
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

export interface UseWorkUnitKpisResult {
  index: KpiIndex;
  /** Re-reads now. Resolves when that read has landed (or failed). */
  refresh: () => Promise<void>;
}

export function useWorkUnitKpis(kpiWindow: string): UseWorkUnitKpisResult {
  // Held WITH the window it answers, so a window change reads as `pending`
  // without a reset effect: a different window's figures are never shown under
  // this one's heading.
  const [held, setHeld] = useState<{ window: string; index: KpiIndex }>({
    window: kpiWindow,
    index: KPI_PENDING,
  });
  /** Generation counter: a read whose number is stale lands nothing. */
  const generation = useRef(0);

  const read = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const body = await fetchKpis(
        { window: kpiWindow },
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (mine !== generation.current) return;
      if (!isKpisPayload(body)) {
        setHeld({
          window: kpiWindow,
          index: { state: "unavailable", reason: KPIS_SCHEMA_MISMATCH_REASON },
        });
        return;
      }
      setHeld({
        window: kpiWindow,
        index: indexKpis(body, new Date().toISOString()),
      });
    } catch (e) {
      if (mine !== generation.current) return;
      const reason = describeCoordPollError(e, {
        routeUnavailableText: KPIS_ROUTE_UNAVAILABLE_TEXT,
      });
      setHeld((prev) =>
        prev.window === kpiWindow && prev.index.state === "loaded"
          ? { window: kpiWindow, index: { ...prev.index, staleReason: reason } }
          : { window: kpiWindow, index: { state: "unavailable", reason } }
      );
    }
  }, [kpiWindow]);

  useEffect(() => {
    void read();
    return () => {
      // Unmount or a new window: whatever is still out must not land. A
      // counter, not a DOM node — the "will have changed" the rule guards
      // against is exactly what this bump relies on.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [read]);

  return {
    index: held.window === kpiWindow ? held.index : KPI_PENDING,
    refresh: read,
  };
}
