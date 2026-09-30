"use client";

/**
 * `GET /api/v1/operations/alerts/fault-to-visibility[?window=]` — how long a
 * fault existed before anyone who can act on it could see it, and the wire
 * shape it serves.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8, over coord's Phase 4 read (perceive gap G1). The web route is a
 * pass-through proxy of coord's `GET /coord/alerts/fault-to-visibility`; this
 * hook mirrors `useFleetHealth` — single-flight, no retries, the next tick is
 * the retry, and a failed read keeps the last body rather than clearing it.
 *
 * The interval is `visible_at − onset_at` per alert episode. Coord computes
 * its percentiles ONLY over episodes whose onset is known and serves
 * `onset_known_n` beside `episodes_n`, so the share is read with the number,
 * never dropped: a p90 over 3 of 400 episodes is a very different claim from
 * one over 380. A `null` percentile is "no episode with a known onset" —
 * never zero seconds. `fleetReadout.ts` is the one place this turns into
 * operator words.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

/** Same-origin literal, like `FLEET_HEALTH_API`. */
export const FAULT_TO_VISIBILITY_API =
  "/api/v1/operations/alerts/fault-to-visibility";

/**
 * Poll cadence. The read is a trailing-window percentile (coord's default
 * window is days, not minutes), so a faster poll re-reads the same answer.
 */
export const FAULT_TO_VISIBILITY_POLL_MS = 60_000;

/** One percentile row — per kind, and the totals. */
export interface FaultToVisibilityRow {
  episodes_n: number;
  /** Episodes whose onset is KNOWN — the population the percentiles cover. */
  onset_known_n: number;
  /** `null` = no known-onset episode. Never zero seconds. */
  p50_secs: number | null;
  p90_secs: number | null;
}

export interface FaultToVisibilityKind extends FaultToVisibilityRow {
  /** Coord's alert kind wire string. */
  kind: string;
}

export interface FaultToVisibilityPayload {
  /** The trailing window coord computed over, in coord's own grammar. */
  window: string;
  computed_at: string;
  kinds: FaultToVisibilityKind[];
  totals: FaultToVisibilityRow;
}

/**
 * Accept a body only when it carries the fields every reader dereferences.
 * A pass-through proxy forwards whatever coord says; a body of another shape
 * is a failed read, never an empty one.
 */
export function isFaultToVisibilityPayload(
  body: unknown
): body is FaultToVisibilityPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    Array.isArray(b.kinds) &&
    b.kinds.every(
      (k) =>
        isRow(k) && typeof (k as Record<string, unknown>).kind === "string"
    ) &&
    isRow(b.totals)
  );
}

/** A percentile row: counts are numbers, each percentile a number or `null`. */
function isRow(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const pct = (x: unknown) => x === null || typeof x === "number";
  return (
    typeof r.episodes_n === "number" &&
    typeof r.onset_known_n === "number" &&
    pct(r.p50_secs) &&
    pct(r.p90_secs)
  );
}

export interface UseFaultToVisibilityResult {
  data: FaultToVisibilityPayload | null;
  loading: boolean;
  /** Transport failure; `data` is kept (a failed read says nothing about faults). */
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFaultToVisibility(): UseFaultToVisibilityResult {
  const [data, setData] = useState<FaultToVisibilityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await httpClient.get<unknown>(
        FAULT_TO_VISIBILITY_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      if (!isFaultToVisibilityPayload(body)) {
        setError("coord answered without a fault-to-visibility body");
        return;
      }
      setData(body);
      setError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(
        describeCoordPollError(e, {
          routeUnavailableText: "coord does not serve fault-to-visibility yet",
        })
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FAULT_TO_VISIBILITY_POLL_MS);

  return { data, loading, error, refresh };
}
