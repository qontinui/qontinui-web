"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPlans } from "@/lib/api/operations/coordPlans";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { walkWorkUnits } from "@/app/(app)/admin/coord/work-units/planWalk";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/work-units/plansHealth";

/**
 * The tenant's work units, for the Twin map's plans (plan
 * `2026-10-23-console-presentation-spaces` Phase 5, D1: no parallel data
 * path). This is the read `/admin/coord/work-units` makes — the same typed
 * client (`fetchPlans` → `GET /api/v1/operations/plans` → coord's
 * `/coord/work-units`) walked to the end of coord's list by the same
 * `walkWorkUnits`, in authoring order — so the plans and statuses here are
 * exactly the ones that page lists.
 *
 * Why one walk rather than one `?area=` read per mapped area: coord does
 * filter by area, but the manifest maps ~45 areas, and every read through the
 * proxy also pays its body-signal reads, so per-area reads would cost several
 * times the walk; the walk also returns the units named by an explicit `plan`
 * slug, which no area read would.
 *
 * coord's own `shepherd-*` merge escalations are left out server-side (the
 * page's own shepherd exclusion). They carry no area and no manifest names
 * one, so they can never join a sub-space; excluding them halves the walk
 * (2,374 of 5,238 units on 2026-10-23). A coord that predates the exclusion
 * ignores it and returns them, and they still join nothing.
 *
 * Cadence: the walk is several sequential reads, so it is polled on the
 * work-units page's walked-view cadence (120 s) and only while the Twin map is
 * mounted (an inactive tab unmounts). A failed refresh keeps the last good
 * list, and the map says it is the last good one.
 */
export function useTwinWorkUnits() {
  return useQuery({
    queryKey: ["digital-twin", "work-units"],
    queryFn: async ({ signal }) => {
      const base = new URLSearchParams({
        exclude_slug_prefix: SHEPHERD_SLUG_PREFIX,
      });
      const outcome = await walkWorkUnits(
        (query) =>
          fetchPlans(query, { ...COORD_DASHBOARD_POLL_OPTIONS, signal }),
        base,
        "authored_desc",
        () => !signal.aborted
      );
      // `null` only when the walk was superseded mid-way — react-query has
      // already discarded this run, so the rejection is never rendered.
      if (outcome === null)
        throw new Error("the work-unit read was superseded");
      return outcome;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
