/**
 * Holding the last live-custody reading across background polls.
 *
 * Resolving custody makes coord join `coord.agent_status` and resolve session
 * names for EVERY unit in the tenant, so the plans page asks for it
 * (`include_custody=true`) only on the reads an operator caused — the first
 * read of a window, a manual refresh, a page or search change — and on the
 * 30 s background poll only until one custody read has succeeded for the
 * current window/search.
 *
 * A poll answer after that carries no custody (`live_sessions` and
 * `custody_resolved` both null). Painting that as-is would flip every badge to
 * "not reported" every 30 s; painting the held reading with no age would make
 * a minutes-old reading look live. So the held reading is re-applied to the
 * stems it covers AND the page states its age ("custody as of HH:MM").
 *
 * Only a row whose axis A is still readable and present takes a held value: a
 * poll that could not read coord's list is UNKNOWN now, and an old custody
 * reading must not paper over that.
 */

import type {
  ReconciliationAxisA,
  ReconciliationResponse,
} from "@/components/admin/coord/planReconciliationStatus";
import { clockTime } from "./custody";

type HeldAxis = Pick<ReconciliationAxisA, "live_sessions" | "custody_resolved">;

export interface CustodyHold {
  /** When the reading was received (ms since epoch). */
  at: number;
  /** Per stem, the custody fields of the read that asked for them. */
  byStem: Record<string, HeldAxis>;
}

/** The custody reading a custody-carrying answer holds, keyed by stem. */
export function captureCustody(
  body: ReconciliationResponse,
  at: number
): CustodyHold {
  const byStem: Record<string, HeldAxis> = {};
  for (const row of body.items ?? []) {
    if (!row.axis_a.readable || !row.axis_a.present) continue;
    byStem[row.slug] = {
      live_sessions: row.axis_a.live_sessions ?? null,
      custody_resolved: row.axis_a.custody_resolved ?? null,
    };
  }
  return { at, byStem };
}

/** Did this row's answer carry no custody at all (a poll answer)? */
function carriesNoCustody(axis: ReconciliationAxisA): boolean {
  return (
    (axis.live_sessions === null || axis.live_sessions === undefined) &&
    (axis.custody_resolved === null || axis.custody_resolved === undefined)
  );
}

/**
 * Re-apply a held reading to a poll answer. Returns the answer unchanged when
 * nothing was held for any of its rows; `applied` says whether any row now
 * shows a held (not freshly read) custody.
 */
export function applyHeldCustody(
  body: ReconciliationResponse,
  hold: CustodyHold | null
): { body: ReconciliationResponse; applied: boolean } {
  if (hold === null) return { body, applied: false };
  let applied = false;
  const items = (body.items ?? []).map((row) => {
    const held = hold.byStem[row.slug];
    if (
      held === undefined ||
      !row.axis_a.readable ||
      !row.axis_a.present ||
      !carriesNoCustody(row.axis_a)
    ) {
      return row;
    }
    applied = true;
    return { ...row, axis_a: { ...row.axis_a, ...held } };
  });
  return applied ? { body: { ...body, items }, applied } : { body, applied };
}

/** Does any stem in the hold actually carry a custody reading? */
export function holdCarriesCustody(hold: CustodyHold): boolean {
  return Object.values(hold.byStem).some(
    (h) => h.live_sessions !== null || h.custody_resolved !== null
  );
}

/** Past this age the custody line also states the date. */
const STALE_DATE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Where the custody on screen came from (see the plans page). */
export type CustodySource = "fresh" | "held" | "none";

/** `YYYY-MM-DD` in LOCAL time, matching `clockTime`'s local hours. */
function localDate(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The page-level age line for a custody reading, or `null` when no row on
 * screen carries it (`source === "none"`).
 */
export function describeCustodyAge(
  hold: CustodyHold | null,
  source: CustodySource,
  now: number
): string | null {
  if (hold === null || source === "none") return null;
  const time = clockTime(new Date(hold.at).toISOString()) ?? "an unknown time";
  // A clock time alone is ambiguous once the reading may be from another day.
  const at =
    now - hold.at > STALE_DATE_AFTER_MS
      ? `${localDate(hold.at)} ${time}`
      : time;
  return source === "held"
    ? `custody as of ${at} — held from an earlier read; the 30 s background poll does not re-resolve custody (refresh to re-read it)`
    : `custody as of ${at}`;
}
