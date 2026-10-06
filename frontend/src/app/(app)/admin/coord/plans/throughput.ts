/**
 * Plans started / shipped per day — coord's server-side aggregate, read and
 * laid out WITHOUT inventing a single bar.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 4
 * (backed by Phase 0b, `work_unit_throughput.rs`). The response:
 *
 * ```json
 * {"since": "...Z", "until": "...Z", "bucket": "day", "timezone": "UTC",
 *  "statuses": ["in_progress", "shipped"], "count": 2,
 *  "buckets": [{"day": "2026-09-01", "to_status": "shipped", "count": 3}]}
 * ```
 *
 * **A `(day, to_status)` pair nothing entered is ABSENT, never zero** — coord
 * says so in its module docs, because zero-filling would assert "no transition
 * that day" for days its history table may simply not cover. So this module
 * never zero-fills either: a day appears only when coord returned a bucket for
 * it, and within that day a series appears only when its own bucket came back.
 * An empty `buckets` is "no data in this range" — never a row of zero-height
 * bars rendered as a measurement.
 *
 * A bucket counts DISTINCT units per day, so a column's sum is unit-days, not
 * units; the totals here are labelled that way.
 */

/** "started" is entering `in_progress`; "shipped" is entering `shipped`. */
export const STARTED_STATUS = "in_progress";
export const SHIPPED_STATUS = "shipped";

export interface ThroughputBucket {
  day: string;
  to_status: string;
  count: number;
}

export interface ThroughputResponse {
  since?: string;
  until?: string;
  bucket?: string;
  timezone?: string;
  statuses?: string[];
  count?: number;
  buckets?: ThroughputBucket[];
}

/** One day coord returned at least one bucket for. */
export interface ThroughputDay {
  day: string;
  /** ABSENT (undefined) when coord returned no `shipped` bucket that day. */
  shipped?: number;
  /** ABSENT (undefined) when coord returned no `in_progress` bucket that day. */
  started?: number;
}

export type ThroughputReading =
  | { state: "pending" }
  | { state: "failed"; reason: string; notServed: boolean }
  | { state: "unparseable"; reason: string }
  | { state: "empty"; since: string | null; until: string | null }
  | {
      state: "loaded";
      since: string | null;
      until: string | null;
      days: ThroughputDay[];
      /** Sums over the returned buckets — unit-days, not units. */
      shippedUnitDays: number;
      startedUnitDays: number;
    };

/** The date-range control's choices, in days back from today (UTC). */
export const THROUGHPUT_RANGES: readonly number[] = [7, 30, 90, 365];
export const DEFAULT_THROUGHPUT_DAYS = 30;

/**
 * `since` for a range: the UTC date `days` days before `now`, as `YYYY-MM-DD`
 * — coord reads a bare date as that day's 00:00:00Z, and its 366-day bound is
 * day-granular, so a date never trips it on a clock edge.
 */
export function sinceForRange(days: number, now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isBucket(v: unknown): v is ThroughputBucket {
  if (v === null || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.day === "string" &&
    typeof b.to_status === "string" &&
    typeof b.count === "number"
  );
}

/** Lay out a response. Never zero-fills; never trusts an unexpected shape. */
export function deriveThroughput(body: unknown): ThroughputReading {
  if (body === null || typeof body !== "object") {
    return {
      state: "unparseable",
      reason: "the route returned no JSON object",
    };
  }
  const res = body as ThroughputResponse;
  if (!Array.isArray(res.buckets)) {
    return {
      state: "unparseable",
      reason: "the response carries no buckets list",
    };
  }
  if (!res.buckets.every(isBucket)) {
    return {
      state: "unparseable",
      reason: "a bucket is not {day, to_status, count}",
    };
  }
  const since = typeof res.since === "string" ? res.since : null;
  const until = typeof res.until === "string" ? res.until : null;
  const byDay = new Map<string, ThroughputDay>();
  let shippedUnitDays = 0;
  let startedUnitDays = 0;
  for (const b of res.buckets) {
    if (b.to_status !== SHIPPED_STATUS && b.to_status !== STARTED_STATUS) {
      continue;
    }
    const day = byDay.get(b.day) ?? { day: b.day };
    if (b.to_status === SHIPPED_STATUS) {
      day.shipped = (day.shipped ?? 0) + b.count;
      shippedUnitDays += b.count;
    } else {
      day.started = (day.started ?? 0) + b.count;
      startedUnitDays += b.count;
    }
    byDay.set(b.day, day);
  }
  if (byDay.size === 0) return { state: "empty", since, until };
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    state: "loaded",
    since,
    until,
    days,
    shippedUnitDays,
    startedUnitDays,
  };
}

/** `YYYY-MM-DD` of an echoed bound, for the caption. */
export function echoDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "an unstated bound";
}
