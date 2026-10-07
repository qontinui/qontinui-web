/** Pure helpers for the Unfinished page (no fetching, no React). */

import type { UnfinishedSession, UnfinishedSessionsView } from "../types";

/**
 * Why a row cannot be resumed, or null when it can. A respawn is addressed at
 * a machine, so a row whose device coord did not record has nowhere to go —
 * that is a stated reason, never a silently dead button.
 */
export function resumeBlockedReason(row: UnfinishedSession): string | null {
  if (!row.device_id) {
    return "Coord did not record which device ran this session, so there is nowhere to resume it.";
  }
  return null;
}

/** Human text for the sweep's last verdict; null verdict = never swept. */
export function verdictLabel(verdict: string | null): string {
  if (verdict === null || verdict === "") return "not swept yet";
  return verdict;
}

/** Why coord could not read the census, in the operator's words. */
export function unknownReasonText(view: UnfinishedSessionsView): string {
  switch (view.reason) {
    case "schema_migration_pending":
      return "coord's database has not been migrated for this view yet";
    case "census_unreadable":
      return "coord could not read the session census";
    case "pool_unavailable":
      return "coord's database was unreachable";
    case "malformed_response":
      return "coord's answer was not in the expected shape";
    default:
      return view.reason ?? "coord gave no reason";
  }
}

export function transcriptText(row: UnfinishedSession): string {
  if (!row.transcript) return "transcript unknown";
  const { coord_warm_bytes: warm, coord_cold: cold } = row.transcript;
  const parts: string[] = [];
  parts.push(warm > 0 ? `${warm.toLocaleString()} B warm` : "no warm copy");
  parts.push(cold ? "cold tier on" : "no cold tier");
  return parts.join(", ");
}
