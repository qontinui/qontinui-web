/**
 * operatorTouchSlo — the SLO Dashboard's tenant-level operator-touch line and
 * its dead-neighbour labels, derived as pure functions.
 *
 * Plan `2026-08-27-operator-touch-read-and-surface` Phase C3 (V6, C2a). coord's
 * `GET /pr-merge/slo` gains two TENANT-level fields:
 *
 * - `operator_touch {last_7d, last_30d}` — touches carry no repo, so this is
 *   one line for the tenant, never a tile duplicated into every repo card.
 * - `structurally_zero` — the per-repo window fields with no live writer
 *   (`operator_override_rate`, `escalation_rate`). They render beside the new
 *   touch rate, and a reader comparing a live number to two zeros concludes the
 *   wrong thing unless the zeros say they are dead.
 *
 * The rule every arm keeps: an absent or empty measurement is NEVER a zero.
 * `not_yet_measured` is "Not yet measured — the touch emitter has not run";
 * `unreadable`, an unrecognised measurement word, or a coord that predates the
 * block are all unknown.
 */

import { shareOfFraction } from "@/components/console/share";

export interface OperatorTouchSloWindow {
  /** `measured` | `not_yet_measured` | `unreadable`. */
  measurement: string;
  /** Set only when `unreadable`: `schema_migration_pending` | `db_unavailable`. */
  unreadable_reason?: string | null;
  touches?: number | null;
  operator_reaching?: number | null;
  operator_reaching_per_day?: number | null;
  agent_absorbed_rate?: number | null;
  unknown_share?: number | null;
  policy_authorized_split?: { yes: number; no: number; unknown: number } | null;
  measured_since?: string | null;
  covered_days?: number | null;
}

export interface OperatorTouchSlo {
  last_7d?: OperatorTouchSloWindow | null;
  last_30d?: OperatorTouchSloWindow | null;
}

export type TouchWindowState = "measured" | "not_yet_measured" | "unknown";

export interface TouchWindowView {
  state: TouchWindowState;
  /** The one phrase the strip shows for this window. */
  text: string;
  /** Tooltip — the numbers behind the phrase, or why there are none. */
  title: string;
}

export const NOT_YET_MEASURED_TEXT =
  "Not yet measured — the touch emitter has not run";

const UNREADABLE_WORDS: Record<string, string> = {
  schema_migration_pending:
    "the touch store is not provisioned in this database yet",
  db_unavailable: "coord's database did not answer",
};

function unreadableWords(reason: string | null | undefined): string {
  return reason && Object.prototype.hasOwnProperty.call(UNREADABLE_WORDS, reason)
    ? (UNREADABLE_WORDS[reason] as string)
    : "the touch store could not be read";
}

/** One window, in words. */
export function describeTouchWindow(
  w: OperatorTouchSloWindow | null | undefined
): TouchWindowView {
  if (!w) {
    return {
      state: "unknown",
      text: "Unknown",
      title: "coord did not report operator touches for this window",
    };
  }
  if (w.measurement === "not_yet_measured") {
    return {
      state: "not_yet_measured",
      text: NOT_YET_MEASURED_TEXT,
      title:
        "No operator touch has ever been recorded for this tenant, so there is no rate — not a rate of zero.",
    };
  }
  if (w.measurement !== "measured") {
    return {
      state: "unknown",
      text: "Unknown",
      title:
        w.measurement === "unreadable"
          ? `Unknown — ${unreadableWords(w.unreadable_reason)}.`
          : "Unknown — coord reported a measurement this page does not know.",
    };
  }
  const perDay =
    typeof w.operator_reaching_per_day === "number" &&
    Number.isFinite(w.operator_reaching_per_day)
      ? `${w.operator_reaching_per_day.toFixed(1)}/day reached you`
      : "–/day reached you";
  const absorbed = `${shareOfFraction(w.agent_absorbed_rate)} agent-absorbable`;
  const split = w.policy_authorized_split;
  return {
    state: "measured",
    text: `${perDay} · ${absorbed}`,
    title: [
      `${w.touches ?? "–"} touches, ${w.operator_reaching ?? "–"} reached a person`,
      typeof w.covered_days === "number"
        ? `over ${w.covered_days.toFixed(1)} covered days`
        : null,
      `routing unknown ${shareOfFraction(w.unknown_share)}`,
      split
        ? `judged against policy: ${split.yes} allowed, ${split.no} not called for, ${split.unknown} not yet judged`
        : null,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

/** Both windows. A coord predating the block yields two unknowns, not zeros. */
export function describeOperatorTouchSlo(
  block: OperatorTouchSlo | null | undefined
): { last7d: TouchWindowView; last30d: TouchWindowView } {
  return {
    last7d: describeTouchWindow(block?.last_7d),
    last30d: describeTouchWindow(block?.last_30d),
  };
}

/**
 * The `structurally_zero` list as a set. Absent (a coord predating it) is an
 * EMPTY set — this page then labels nothing dead, because it cannot know.
 */
export function structurallyZeroSet(
  names: readonly string[] | null | undefined
): ReadonlySet<string> {
  return new Set(Array.isArray(names) ? names : []);
}

/** The label a dead neighbour carries beside its (always-0) value. */
export const STRUCTURALLY_ZERO_LABEL = "structurally 0";

export const STRUCTURALLY_ZERO_TITLE =
  "No live writer produces this metric, so it reads 0 by construction — it is not a measurement. The live interruption rate is the tenant-wide Operator touches line.";
