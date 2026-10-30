/**
 * When each spawn path last started a session — read from the spawn ledger
 * the page already holds (`useSpawnLedger`'s window list), never a second
 * fetch.
 *
 * The ledger can answer for a path only where one of its rows NAMES that path
 * and no other: its `origin` column (`gate_continuation`, `unit_continuation`,
 * `steward`). Every coord fixer, the shepherd and the condition audits share
 * the origin `coord_dispatch`, and a post-merge follow-up is a gate continuation
 * — so for those the cell is UNKNOWN and says the ledger carries no field that
 * names the path. The same goes for a path with no writer at all (the runner
 * scheduler): an origin the column permits is not a record anyone writes. It is
 * never "never", never blank and never 0.
 *
 * What the list measures bounds what a cell may claim. It holds the requests
 * MADE in the window (`requested_at` inside it), so a request made earlier
 * that started inside the window is not on it: a start found there is a
 * LOWER bound on how recently the path started ("started 3h ago or more
 * recently"), and "none" is said of the requests the list holds, never of the
 * path. And an origin that names only SOME of a path's starts (stewards
 * started from a runner's own window are recorded as operator terminals) can
 * prove a start but not an absence: its "none" is UNKNOWN.
 *
 * | what the ledger said | the cell |
 * |---|---|
 * | the read has not answered | UNKNOWN — still reading |
 * | `{available: false}`, a 404, a refusal | UNKNOWN — the ledger's own reason (`spawnIssueText`) |
 * | no field names the path | UNKNOWN — which field is missing |
 * | a row of the path's origin started | that newest `spawned_at`, as a lower bound |
 * | none did, and the origin names every start | what was measured: "no request in the last 7 days", "2 requests in the last 7 days, none started" |
 * | none did, and the origin names only some starts | UNKNOWN — why |
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

/** How the ledger attributes a path's starts. */
export interface LedgerAttribution {
  /** The origin that names the path and no other; absent when none does. */
  origin?: string;
  /** Why no field names the path (used when `origin` is absent). */
  blind: string;
  /** Set when `origin` names only SOME of the path's starts, and why. */
  partial?: string;
}

export type LastSpawnedCell =
  | {
      kind: "spawned";
      /** RFC 3339 `spawned_at` of the newest start found. */
      at: string;
      /** What the list held, in words: "the requests made in the last 7 days". */
      measured: string;
      /** The list this came from is the last good read, not now's. */
      stale: boolean;
    }
  | {
      kind: "none";
      /** What was measured: "no request in the last 7 days", "2 requests …, none started". */
      text: string;
      stale: boolean;
    }
  | { kind: "unknown"; reason: string; presentedReason: string };

/** The fixed sentence an outsider reads for a ledger read that did not answer. */
const LEDGER_UNREAD_PRESENTED =
  "When this path last started a session is unknown: the record of spawn requests could not be read.";

function requestsText(n: number): string {
  return `${n} request${n === 1 ? "" : "s"}`;
}

/** The cell for a path, by how the ledger attributes its starts. */
export function lastSpawnedCell(
  view: LedgerListView,
  attribution: LedgerAttribution
): LastSpawnedCell {
  const { origin, blind, partial } = attribution;
  if (origin === undefined) {
    return {
      kind: "unknown",
      reason: `UNKNOWN — ${blind}.`,
      presentedReason:
        "When this path last started a session is unknown: the record of spawn requests does not identify this path's starts.",
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
  let requests = 0;
  for (const row of list.items) {
    if (!isSpawnRow(row) || row.origin !== origin) continue;
    requests += 1;
    if (!row.spawned_at) continue;
    const ms = Date.parse(row.spawned_at);
    if (!Number.isFinite(ms)) continue;
    if (newest === null || ms > newest.ms) newest = { at: row.spawned_at, ms };
  }
  const loaded = list.items.length;
  const measured = list.truncated
    ? `the ${loaded} most recent requests loaded`
    : `the requests made in the ${view.windowLabel}`;
  if (newest !== null) {
    return { kind: "spawned", at: newest.at, measured, stale };
  }
  if (partial !== undefined) {
    return {
      kind: "unknown",
      reason: `UNKNOWN — none of ${measured} under this path's origin started, but ${partial}.`,
      presentedReason:
        "When this path last started a session is unknown: the record of spawn requests names only some of its starts.",
    };
  }
  const where = list.truncated
    ? `among the ${loaded} most recent loaded`
    : `in the ${view.windowLabel}`;
  return {
    kind: "none",
    text:
      requests === 0
        ? `no request ${where}`
        : `${requestsText(requests)} ${where}, none started`,
    stale,
  };
}
