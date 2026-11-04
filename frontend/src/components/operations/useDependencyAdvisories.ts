"use client";

/**
 * Polling hook for the fleet Rust advisory census (plan
 * `2026-11-02-rust-advisories-have-no-fleet-consumer` Phase 5).
 *
 * Transport: the authenticated REST proxy
 * `GET /api/v1/operations/coord/dependency-advisories`, which forwards the
 * operator bearer to coord's `GET /coord/dependency-advisories` and passes its
 * body and its error answers through verbatim. Never coord from the browser —
 * the same posture as every other Dev Ops poll.
 *
 * Same shape as `useFleetWorktreeSlots`: single-flight, one request per tick
 * (`COORD_DASHBOARD_POLL_OPTIONS`), and a failed read KEEPS the last body —
 * the section renders it as last-known, never clears it into an empty list
 * that would read as "no repos".
 *
 * The census is written once per scheduling cycle (hours, not seconds), so
 * the poll is slow; the section's age column is driven by the page clock,
 * not by this cadence.
 */

import { useCallback, useState } from "react";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { fetchDependencyAdvisories } from "@/lib/api/operations/coordDependencyAdvisories";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import {
  parseDependencyAdvisoriesPayload,
  type DependencyAdvisoriesPayload,
} from "./dependencyAdvisories";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

/** Poll cadence: five minutes. */
export const DEPENDENCY_ADVISORIES_POLL_MS = 300_000;

/** Coord's answer before its dependency-advisory tables exist. */
export const SURFACE_UNAVAILABLE_TEXT =
  "coord's dependency-advisory store is not available yet (its migration has not applied)";

/**
 * The banner text for a failed read. Coord's
 * `503 {"error":"dependency_advisories_surface_unavailable"}` is named
 * specifically — the status AND the parsed body field, never either alone;
 * everything else goes through the shared coord-poll wording.
 */
export function describeDependencyAdvisoriesError(err: unknown): string {
  if (httpStatusOf(err) === 503) {
    const bodyText = httpBodyOf(err);
    try {
      const body: unknown = bodyText ? JSON.parse(bodyText) : null;
      if (
        typeof body === "object" &&
        body !== null &&
        (body as Record<string, unknown>).error ===
          "dependency_advisories_surface_unavailable"
      ) {
        return SURFACE_UNAVAILABLE_TEXT;
      }
    } catch {
      // Not JSON: fall through to the shared wording.
    }
  }
  return describeCoordPollError(err, {
    routeUnavailableText:
      "coord does not serve the dependency-advisories route yet",
  });
}

export interface UseDependencyAdvisoriesResult {
  data: DependencyAdvisoriesPayload | null;
  loading: boolean;
  /** Failure text; `data` is kept as last-known (never cleared). */
  error: string | null;
  /** `Date.now()` when `data` arrived; stamped only on success. */
  fetchedAtMs: number | null;
  refresh: () => void;
}

export function useDependencyAdvisories(): UseDependencyAdvisoriesResult {
  const [data, setData] = useState<DependencyAdvisoriesPayload | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await fetchDependencyAdvisories(
        { includeResolved: false },
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      const parsed = parseDependencyAdvisoriesPayload(body);
      if (parsed === null) {
        setError("coord answered without a dependency-advisory census body");
        return;
      }
      setData(parsed);
      setFetchedAtMs(Date.now());
      setError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(describeDependencyAdvisoriesError(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, DEPENDENCY_ADVISORIES_POLL_MS);

  return { data, loading, error, fetchedAtMs, refresh };
}
