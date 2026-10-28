/**
 * When each spawn path last started a session — read from the spawn ledger
 * the page already holds (`useSpawnLedger`'s window list), never a second
 * fetch.
 *
 * The ledger can answer for a path only where one of its rows NAMES that path
 * and no other: its `origin` column (`gate_continuation`, `unit_continuation`,
 * `steward`, `scheduler`). Every coord fixer, the shepherd and the condition
 * audits share the origin `coord_dispatch`, and a post-merge follow-up is a
 * gate continuation — so for those the cell is UNKNOWN and says the ledger
 * carries no field that names the path. It is never "never", never blank and
 * never 0:
 *
 * | what the ledger said | the cell |
 * |---|---|
 * | the read has not answered | UNKNOWN — still reading |
 * | `{available: false}`, a 404, a refusal | UNKNOWN — the ledger's own reason (`spawnIssueText`) |
 * | no field names the path | UNKNOWN — which field is missing |
 * | rows of that origin started | the newest `spawned_at`, dated |
 * | the window holds none that started | "none started in the <window>" — a measured window, not "never" |
 * | the list was cut at coord's page bound | "none among the N most recent requests" |
 *
 * A failed refresh keeps the last good list (the hook's rule) and the cell
 * says it is the last good read's answer.
 */

import type { SpawnListWire, SpawnReadIssue } from "./spawnStatus";
import { isSpawnRow, spawnIssueText } from "./spawnStatus";

/** What the page knows of the ledger's window list. */
export interface LedgerListView {
  /** The last good list for the window on screen, or `null`. */
  list: SpawnListWire | null;
  /** The latest read's issue; `null` after a success. */
  issue: SpawnReadIssue | null;
  /** The window's words ("last 7 days"). */
  windowLabel: string;
}

export type LastSpawnedCell =
  | {
      kind: "spawned";
      /** RFC 3339 `spawned_at` of the newest start. */
      at: string;
      /** The list this came from is the last good read, not now's. */
      stale: boolean;
    }
  | {
      kind: "none";
      /** "none started in the last 7 days" / "none among the 200 most recent requests". */
      text: string;
      stale: boolean;
    }
  | { kind: "unknown"; reason: string; presentedReason: string };

/** The fixed sentence an outsider reads for a ledger read that did not answer. */
const LEDGER_UNREAD_PRESENTED =
  "When this path last started a session is unknown: the record of spawn requests could not be read.";

/**
 * The cell for a path whose ledger origin is `origin` (absent = the ledger
 * names no field for it, and `blind` says why).
 */
export function lastSpawnedCell(
  view: LedgerListView,
  origin: string | undefined,
  blind: string
): LastSpawnedCell {
  if (origin === undefined) {
    return {
      kind: "unknown",
      reason: `UNKNOWN — ${blind}.`,
      presentedReason:
        "When this path last started a session is unknown: the record of spawn requests does not say which path made each request.",
    };
  }
  const { list, issue } = view;
  if (list === null) {
    return {
      kind: "unknown",
      reason:
        issue === null
          ? "UNKNOWN — the spawn ledger has not answered yet."
          : `UNKNOWN — ${spawnIssueText(issue, "when this path last spawned")}`,
      presentedReason: LEDGER_UNREAD_PRESENTED,
    };
  }
  const stale = issue !== null;
  let newest: { at: string; ms: number } | null = null;
  for (const row of list.items) {
    if (!isSpawnRow(row) || row.origin !== origin || !row.spawned_at) continue;
    const ms = Date.parse(row.spawned_at);
    if (!Number.isFinite(ms)) continue;
    if (newest === null || ms > newest.ms) newest = { at: row.spawned_at, ms };
  }
  if (newest !== null) return { kind: "spawned", at: newest.at, stale };
  return {
    kind: "none",
    text: list.truncated
      ? `none started among the ${list.items.length} most recent requests loaded`
      : `none started in the ${view.windowLabel}`,
    stale,
  };
}
