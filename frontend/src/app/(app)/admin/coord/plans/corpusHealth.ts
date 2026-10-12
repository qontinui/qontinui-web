/**
 * The one-line corpus-health summary on `/admin/coord/plans` — what the
 * collapsed strip says before anyone opens it.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Design
 * decision 4b: the scan-source and coverage panels are TRUST SIGNALS about
 * whether the list can be believed, so their finding stays visible while the
 * detail is folded away (R7).
 *
 * What the summary reads, and what it deliberately does not:
 *
 * - **Scan sources** — from `GET /scan-roots?coverage=false`, the cheap read
 *   (no stem census, no corpus anti-join). "Stale" is the route's own verdict:
 *   `count - fresh_count` feeders without a reading inside
 *   `fresh_within_secs`. A failed read is UNKNOWN; `state: "unknown"` is the
 *   route's no-rows answer and is UNKNOWN as well, never "all fresh".
 * - **Coverage** — NOT read for the summary. `GET /scan-roots` with coverage
 *   is the costly computation `usePlanCoverage` documents, and a summary that
 *   paid it on every page load would double it when the panel opens. The
 *   summary says it is computed on open rather than implying "no gaps".
 * - **Forks** — counted over THIS PAGE's rows (`variant_count > 1`), labelled
 *   as such; the corpus-wide list is `/admin/coord/plan-forks`.
 */

import type { ScanRootListResponse } from "../plan-library/types";
import {
  isDivergent,
  type ReconciliationRowData,
} from "@/components/admin/coord/planReconciliationStatus";

export interface ScanSummary {
  text: string;
  unknown: boolean;
  /** Feeders with no fresh reading — `null` when not measured. */
  stale: number | null;
}

export function summarizeScanSources(
  data: ScanRootListResponse | null,
  error: string | null,
  loading: boolean
): ScanSummary {
  if (data === null) {
    if (error !== null) {
      return {
        text: "scan sources UNKNOWN (could not be read)",
        unknown: true,
        stale: null,
      };
    }
    return {
      text: loading ? "scan sources: reading…" : "scan sources UNKNOWN",
      unknown: true,
      stale: null,
    };
  }
  if (
    data.state !== "reported" ||
    typeof data.count !== "number" ||
    typeof data.fresh_count !== "number"
  ) {
    return {
      text: "no scan-source reading — UNKNOWN, not fresh",
      unknown: true,
      stale: null,
    };
  }
  const stale = Math.max(0, data.count - data.fresh_count);
  const behind = Array.isArray(data.rows)
    ? data.rows.filter((r) => typeof r.behind === "number" && r.behind > 0)
        .length
    : 0;
  const parts = [
    `${stale} of ${data.count} scan source${data.count === 1 ? "" : "s"} stale`,
  ];
  if (behind > 0) parts.push(`${behind} behind its default branch`);
  const suffix = error !== null ? " (last good read; refresh failed)" : "";
  return {
    text: parts.join(", ") + suffix,
    unknown: error !== null,
    stale,
  };
}

/** Divergent stems among the rows on this page. */
export function pageForkCount(rows: ReconciliationRowData[]): number {
  return rows.filter(isDivergent).length;
}
