/**
 * Coord's fleet-partition ratio, in words — derived, pure, and unit-tested
 * (R1 and R8 of `frontend/docs/console-ui-style-guide.md`: the Dev Ops health
 * strip renders a verdict already derived from data on the page, and the
 * derivation is a module, not JSX ternaries).
 *
 * `GET /coord/fleet/health` serves `fleet_partition_ratio`
 * (`qontinui-coord` `crates/coord/src/fleet_partition.rs`
 * `FleetPartitionRatio`): how many of the rows that HEARTBEAT read
 * `partitioned`. It is the same figure coord's `fleet_partitioned` alert
 * reads, so the operator can see how close the fleet is to it.
 *
 * ## The rules it encodes
 *
 * - **Never a percentage over nothing.** `eligible: 0` is "no heartbeating
 *   rows", not `0%`.
 * - **`known: false` is UNKNOWN.** Coord's hard row ceiling withheld rows
 *   that could be degrading, so the ratio is not measured. It says how many
 *   rows were withheld and never shows a percentage.
 * - **Absent is UNKNOWN, never `0`.** A coord predating the block serves
 *   none; the line says so. Before any body has been read, nothing is shown
 *   (the strip's machines badge already says the read has not answered).
 * - **A malformed field is UNKNOWN too**, never coerced to zero.
 * - **The scope is always said**: this route serves the caller's tenant
 *   roster, while the alert reads the unscoped one.
 */

import { shareOfFraction } from "@/components/console/share";
import type { HealthBadgeTone } from "@/components/console";
import type { FleetHealthPayload } from "@/lib/api/operations/coordFleet";

/** The ratio as the strip renders it: one badge. */
export interface FleetPartitionRatioLine {
  /** What the badge says. */
  label: string;
  /** Badge tone: `attention` only when coord says the ratio fires. */
  tone: HealthBadgeTone;
  /** A longer explanation for the badge's tooltip. */
  title: string;
}

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The roster the ratio was computed over, in plain words. */
function scopeText(scope: unknown): string {
  if (scope === "tenant") return "this tenant's machines";
  if (scope === "unscoped") return "every tenant's machines";
  return "scope not stated";
}

/** `n rows` / `1 row`. */
function rows(n: number): string {
  return `${n} ${n === 1 ? "row" : "rows"}`;
}

const WHAT_IT_COUNTS =
  "Of the machines that send coord a heartbeat (CI registrations, " +
  "abandoned machines and rows coord never heard from are left out), how " +
  "many coord can no longer reach.";

/**
 * Read the ratio block off a fleet-health body. `null` when no body has been
 * read yet: there is nothing to say that the machines badge does not.
 */
export function fleetPartitionRatioLine(
  body: Pick<FleetHealthPayload, "fleet_partition_ratio"> | null
): FleetPartitionRatioLine | null {
  if (body === null) return null;
  const r = body.fleet_partition_ratio;
  if (r === undefined || r === null || typeof r !== "object") {
    return {
      label: "partition ratio unknown — this coord does not serve it",
      tone: "waiting",
      title:
        "Coord's fleet-health read carries no partition ratio (an older " +
        "coord, or a proxy dropped it). Unknown, not zero.",
    };
  }
  const scope = scopeText(r.scope);
  if (r.known === false) {
    const withheld = isCount(r.degradable_dropped)
      ? `${r.degradable_dropped} degradable ${r.degradable_dropped === 1 ? "row" : "rows"}`
      : "an uncounted number of degradable rows";
    return {
      label: `partition ratio UNKNOWN: coord withheld ${withheld}`,
      tone: "waiting",
      title:
        `Coord's row limit withheld ${withheld} that could be degrading, so ` +
        `it cannot say what share of ${scope} is partitioned. ${WHAT_IT_COUNTS}`,
    };
  }
  if (r.known !== true || !isCount(r.eligible) || !isCount(r.partitioned)) {
    return {
      label: "partition ratio unknown — coord's figure could not be read",
      tone: "waiting",
      title:
        "Coord served a partition ratio this page could not read (a missing " +
        "or malformed field). Unknown, not zero.",
    };
  }
  if (r.eligible === 0) {
    return {
      label: `partition ratio: no heartbeating rows (${scope})`,
      tone: "muted",
      title:
        `No machine in ${scope} sends coord a heartbeat, so there is no ` +
        `share to measure — not 0%. ${WHAT_IT_COUNTS}`,
    };
  }
  const pct =
    typeof r.pct === "number" && Number.isFinite(r.pct)
      ? shareOfFraction(r.pct / 100)
      : null;
  const fires = r.fires === true;
  const threshold =
    typeof r.threshold_pct === "number" && Number.isFinite(r.threshold_pct)
      ? ` Coord alerts above ${r.threshold_pct}%${isCount(r.min_devices) ? ` with at least ${r.min_devices} partitioned` : ""}.`
      : "";
  return {
    label: `${r.partitioned}/${r.eligible} heartbeating rows partitioned${pct !== null ? ` (${pct})` : ""} — ${scope}`,
    tone: fires ? "attention" : "muted",
    title:
      `${rows(r.partitioned)} of ${rows(r.eligible)} in ${scope} read partitioned.` +
      ` ${WHAT_IT_COUNTS}${threshold}${fires ? " Coord says this ratio is over its alert threshold." : ""}`,
  };
}
