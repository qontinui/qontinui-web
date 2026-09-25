"use client";

/**
 * Polling hook for the fleet worktree-allocation-slot surface (plan
 * `2026-09-21-worktree-slots-devops-dashboard-view.md` Phase 3).
 *
 * Transport: the authenticated REST proxy
 * `GET /api/v1/operations/fleet/worktree-slots`, which forwards the operator
 * bearer to coord's `GET /coord/fleet/worktree-slots` and keeps tenant
 * scoping server-side.
 *
 * **Never call coord from the browser** — same posture as
 * `useFleetResourceSamples`: `DeviceStatusTile` recorded what happened the
 * last time a coord read went out anonymously (coord went operator-auth
 * fail-closed and the tile silently emptied).
 *
 * This is the Dev Ops page's FIFTH recurring poll (`devops/page.tsx`'s own
 * header comment enumerates the other four and states the one-route-per-fact
 * rationale this poll follows: two polls of one route would be two chances
 * to disagree about what the fleet looks like right now, so this is its own
 * route rather than folded into the resource-samples poll).
 *
 * **Phase 1 of the driving plan (coord's `GET /coord/fleet/worktree-slots`
 * itself) ships in a separate qontinui-coord PR and had not landed as of this
 * hook's own PR.** Until it does, every read of this route legitimately 404s
 * — that is expected, not a transport failure. Raw-passing `httpClient`'s
 * formatted rejection (`GET <url> failed: 404 - <coord's raw body>`) into the
 * error banner would show every operator a stray, doubly-JSON-encoded string
 * on every load, which is the exact failure class
 * `operations-proxy-checklist.md` §5 and `useSessionCompliance`'s
 * `isRouteUnavailable` both exist to prevent. `describeError` below applies
 * that same, already-shared `httpStatusOf` reader (`httpStatus.ts`) instead
 * of re-deriving the status from the message text.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import { OPERATIONS_API } from "./utils";
import { RESOURCE_POLL_INTERVAL_MS } from "./useFleetResourceSamples";

export const FLEET_WORKTREE_SLOTS_API = `${OPERATIONS_API}/fleet/worktree-slots`;

/**
 * Friendly error text for the banner (`describeCoordPollError`, which reads
 * the status FIELD of `httpClient`'s rejection through the shared anchored
 * `httpStatusOf`, so a coord 500 whose body happens to quote "404" is never
 * misread as route-unavailable):
 *
 * - `404 {"error":"route_disabled"}` — the route's kill switch or tenant dial
 *   is engaged: "disabled by operator". Before plan
 *   `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` Phase 4
 *   every 404 read "not shipped yet", which is a false reason for a route an
 *   operator switched off.
 * - `503 {"error":"deadline","budget_ms":N}` — coord abandoned the read at its
 *   route budget: UNKNOWN, naming the budget.
 * - Any other 404/405/501 — the route is not deployed (a router that knows the
 *   path and not the verb, or knows neither).
 * - Anything else falls through to the raw `httpClient` message.
 */
function describeError(err: unknown): string {
  return describeCoordPollError(err, {
    routeUnavailableText:
      "coord does not serve the fleet worktree-slots route yet (Phase 1 of this feature's plan has not shipped)",
  });
}

/** One occupant of an allocated worktree slot, as coord's `BudgetOccupant` serializes it. */
export interface WorktreeSlotOccupantRow {
  repo: string;
  worktree_path: string;
  /** Seconds since the worktree was allocated — feed to `formatAge`. */
  age_secs: number | null;
  building?: boolean | null;
}

/**
 * Coord's `BudgetOccupancy::bounded` shape, reused verbatim by the fleet
 * route — the same renderer the per-device allocation-budget door and its
 * refusal detail already use, so this list and that one cannot drift.
 */
export interface WorktreeSlotOccupancy {
  shown: number;
  total: number;
  truncated: boolean;
  rows: WorktreeSlotOccupantRow[];
}

export interface WorktreeSlotDevice {
  device_id: string;
  hostname: string | null;
  active_worktrees: number;
  max_worktrees: number;
  /**
   * Count of `coord.worktree_census` rows for this device within the narrow
   * (`census_window_secs`) window — NOT the per-device door's 24h-windowed
   * `census_rows_observed`, a different field with a different meaning.
   *
   * `0` means coord has no recent census hit for this device, so
   * `active_worktrees` could not be corroborated as live and MUST be
   * rendered UNKNOWN by the caller — never an idle/empty machine and never
   * a healthy `0/8`. See `FleetWorktreeSlotsSection`.
   */
  census_recent_rows: number;
  occupants: WorktreeSlotOccupancy;
}

export interface WorktreeSlotsResponse {
  tenant_id: string;
  device_count: number;
  truncated: boolean;
  device_cap: number;
  census_window_secs: number;
  devices: WorktreeSlotDevice[];
}

export interface UseFleetWorktreeSlotsResult {
  data: WorktreeSlotsResponse | null;
  loading: boolean;
  /**
   * Transport/proxy failure. `data` is deliberately NOT cleared — the same
   * "stale beats absent" rule `useFleetResourceSamples` documents: dropping
   * the last payload would render the fleet as *absent* rather than *stale*.
   */
  error: string | null;
  /** `Date.now()` when `data` arrived, or `null` before the first success. */
  fetchedAtMs: number | null;
  refresh: () => void;
}

export function useFleetWorktreeSlots(): UseFleetWorktreeSlotsResult {
  const [data, setData] = useState<WorktreeSlotsResponse | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Single-flight, no retries (D5): on 2026-09-22 a failing tick of this poll
  // cost exactly 5 requests — `httpClient`'s 5xx retry chain — while coord
  // was already past its budget.
  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await httpClient.get<WorktreeSlotsResponse>(
        FLEET_WORKTREE_SLOTS_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      setData(body);
      // Stamped ONLY on success — a failed poll must not refresh the clock
      // that ages `fetchedAtMs`.
      setFetchedAtMs(Date.now());
      setError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(describeError(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, RESOURCE_POLL_INTERVAL_MS);

  return { data, loading, error, fetchedAtMs, refresh };
}
