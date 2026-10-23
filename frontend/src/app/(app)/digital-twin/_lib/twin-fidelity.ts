/**
 * The twin's self-fidelity, as the Completeness tab's header reads it: coord's
 * twin-fidelity report through `GET /api/v1/digital-twin/subspace/twin_fidelity/raw`
 * (plan `2026-10-11-twin-honesty-and-reachability` Phase 9).
 *
 * The read is honest about what it does not know. Every field coord does not
 * serve is `null` and renders UNKNOWN, never 0:
 *  - a 404 means coord serves no `twin_fidelity` read on the twin door yet —
 *    the probe lands with the cached report (that plan's Phase 4b), and
 *    until then there is nothing to read;
 *  - a 403 means the report is Qontinui-internal and this operator's tenant
 *    is not the system tenant;
 *  - a body with no report (`observed: false`, or none of the report's fields)
 *    is UNKNOWN with the reason coord gave, never a zero report.
 *
 * Pure functions (unit-tested in `twin-fidelity.test.ts`).
 */

import type { RawVerdictResponse } from "./types";

/**
 * The sub-space whose raw read carries the twin's self-fidelity report. The
 * Completeness header and the Twin map read it through ONE query key
 * (`useSubspaceRaw(FIDELITY_SUBSPACE, true)`), so they cannot disagree.
 */
export const FIDELITY_SUBSPACE = "twin_fidelity";

/** The report's numbers the header shows; `null` is UNKNOWN. */
export interface FidelityReportView {
  observabilityRate: number | null;
  blindCount: number | null;
  honestyViolations: number | null;
  staleEvidenceViolations: number | null;
  staleAtDecisionViolations: number | null;
  /** The report's age in seconds: `age_seconds`, else from `computed_at`. */
  ageSeconds: number | null;
}

/** What the header can say about the twin's self-fidelity. */
export type FidelityRead =
  | { kind: "loading" }
  | { kind: "internal" }
  | { kind: "unknown"; reason: string }
  | { kind: "report"; report: FidelityReportView };

/** The query state the read is derived from (a `useSubspaceRaw` result). */
export interface FidelityQueryState {
  data: RawVerdictResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * The HTTP status a failed `httpClient.get` carries. The client throws a plain
 * `Error("GET <url> failed: <status> - <body>")`, so the status is read back
 * from that message; `null` when it carries none.
 */
export function httpStatusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /failed: (\d{3})\b/.exec(error.message);
  return match ? Number(match[1]) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The fields a twin-fidelity report carries; one of them marks a report. */
const REPORT_FIELDS = [
  "observability_rate",
  "blind_count",
  "honesty_violations",
  "total",
] as const;

/**
 * Read the header's state from the raw-verdict query. `nowMs` dates a report
 * that carries `computed_at` but no `age_seconds`.
 */
export function readFidelity(
  query: FidelityQueryState,
  nowMs: number
): FidelityRead {
  if (query.isLoading) return { kind: "loading" };
  if (query.isError) {
    const status = httpStatusOf(query.error);
    if (status === 403) return { kind: "internal" };
    if (status === 404) {
      return {
        kind: "unknown",
        reason: "coord serves no twin-fidelity read on the twin door yet",
      };
    }
    return {
      kind: "unknown",
      reason:
        status === null
          ? "the twin-fidelity read failed"
          : `the twin-fidelity read failed (HTTP ${status})`,
    };
  }

  const report = query.data?.verdict as Record<string, unknown> | undefined;
  if (!report || typeof report !== "object") {
    return { kind: "unknown", reason: "coord returned no report" };
  }
  if (report.observed === false) {
    const reason =
      typeof report.reason === "string" && report.reason !== ""
        ? report.reason
        : "no fidelity report has been computed yet";
    return { kind: "unknown", reason };
  }
  if (!REPORT_FIELDS.some((field) => field in report)) {
    return { kind: "unknown", reason: "coord returned no report" };
  }

  let ageSeconds = finiteNumber(report.age_seconds);
  if (ageSeconds === null && typeof report.computed_at === "string") {
    const computedMs = Date.parse(report.computed_at);
    if (!Number.isNaN(computedMs)) {
      ageSeconds = Math.max(0, Math.round((nowMs - computedMs) / 1000));
    }
  }

  return {
    kind: "report",
    report: {
      observabilityRate: finiteNumber(report.observability_rate),
      blindCount: finiteNumber(report.blind_count),
      honestyViolations: finiteNumber(report.honesty_violations),
      staleEvidenceViolations: finiteNumber(report.stale_evidence_violations),
      staleAtDecisionViolations: finiteNumber(
        report.stale_at_decision_violations
      ),
      ageSeconds,
    },
  };
}

/**
 * When the report was computed — its `computed_at`, else `nowMs` less its
 * `age_seconds` — or `null` when the body carries neither (the provenance
 * chip then says UNKNOWN rather than inventing a time).
 */
export function reportComputedAt(
  data: RawVerdictResponse | undefined,
  nowMs: number
): string | number | null {
  const report = data?.verdict as Record<string, unknown> | undefined;
  if (!report || typeof report !== "object") return null;
  if (
    typeof report.computed_at === "string" &&
    !Number.isNaN(Date.parse(report.computed_at))
  ) {
    return report.computed_at;
  }
  const age = finiteNumber(report.age_seconds);
  return age === null ? null : nowMs - age * 1000;
}

/**
 * One sub-space's row of the report (coord `twin_fidelity.rs`
 * `SubspaceFidelity`). Every field coord did not send is `null`.
 */
export interface SubspaceFidelityView {
  subspace: string;
  /** The twin currently observes this sub-space. */
  observed: boolean | null;
  coverage: number | null;
  stalenessSeconds: number | null;
  /**
   * `false` is an honesty violation. `null` when the fold could not judge
   * this sub-space (`honesty_evaluated: false`) — not evidence of honesty.
   */
  honest: boolean | null;
}

/**
 * The report's per-sub-space rows, by sub-space id — or `null` when the body
 * is no report or carries no `subspaces` list (a coord predating it), which
 * is UNKNOWN rather than "no sub-space measured".
 */
export function reportSubspaces(
  data: RawVerdictResponse | undefined
): ReadonlyMap<string, SubspaceFidelityView> | null {
  const report = data?.verdict as Record<string, unknown> | undefined;
  if (!report || typeof report !== "object" || report.observed === false) {
    return null;
  }
  if (!Array.isArray(report.subspaces)) return null;
  const out = new Map<string, SubspaceFidelityView>();
  for (const raw of report.subspaces as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.subspace !== "string" || out.has(row.subspace)) continue;
    const judged = row.honesty_evaluated !== false;
    out.set(row.subspace, {
      subspace: row.subspace,
      observed: typeof row.observed === "boolean" ? row.observed : null,
      coverage: finiteNumber(row.coverage),
      stalenessSeconds: finiteNumber(row.staleness_seconds),
      honest: judged && typeof row.honest === "boolean" ? row.honest : null,
    });
  }
  return out;
}

/** A count, or UNKNOWN for `null`. */
export function formatCount(value: number | null): string {
  return value === null ? "UNKNOWN" : String(value);
}

/** A report age in words, or UNKNOWN for `null`. */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "UNKNOWN";
  if (seconds < 60) return `${seconds}s old`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m old`;
  return `${Math.round(seconds / 3600)}h old`;
}
