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
  // A resume spends quota and re-runs work; only a process SHOWN gone is safe.
  // "unknown" is not "gone" — resuming a live session would fork it.
  if (row.liveness !== "process_gone") {
    return "The process was not shown gone (liveness unknown), so resuming could duplicate a live session.";
  }
  if (resumeAccount(row) === null) {
    return "Coord recorded no account config directory for this session, so it cannot be resumed under its original account.";
  }
  return null;
}

const CONFIG_DIR_BASENAME = /^\.claude(-[A-Za-z0-9_.-]+)?$/;

/**
 * The wire `account` for a respawn: the config-dir BASENAME (e.g.
 * `.claude-gmail`), the form coord's respawn contract takes. Uses
 * `account_label` when it is already in that form, else the basename of
 * `config_dir`; null when neither is — never a display label like "gmail".
 */
export function resumeAccount(row: UnfinishedSession): string | null {
  const label = row.account_label?.trim();
  if (label && CONFIG_DIR_BASENAME.test(label)) return label;
  const dir = row.config_dir?.trim().replace(/[\\/]+$/, "");
  if (dir) {
    const base = dir.split(/[\\/]/).pop() ?? "";
    if (CONFIG_DIR_BASENAME.test(base)) return base;
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
    case "candidate_query_failed":
      return "coord's query for closed sessions failed";
    case "pool_unavailable":
      return "coord's database was unreachable";
    case "malformed_response":
      return "coord's answer was not in the expected shape";
    default:
      return view.reason ?? "coord gave no reason";
  }
}

/**
 * Coord's own diagnostic beside the reason (e.g. the database error text), or
 * null when it sent none. Shown verbatim so an UNKNOWN can be chased.
 */
export function unknownDetailText(view: UnfinishedSessionsView): string | null {
  const detail = view.detail?.trim();
  return detail ? detail : null;
}

export function transcriptText(row: UnfinishedSession): string {
  if (!row.transcript) return "transcript unknown";
  const { coord_warm_bytes: warm, coord_cold: cold } = row.transcript;
  const parts: string[] = [];
  parts.push(warm > 0 ? `${warm.toLocaleString()} B warm` : "no warm copy");
  parts.push(cold ? "cold tier on" : "no cold tier");
  return parts.join(", ");
}
