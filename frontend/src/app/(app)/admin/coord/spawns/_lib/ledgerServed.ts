/**
 * Whether coord serves the spawn ledger at all — the one fact every
 * ledger-backed section on the agentic-activity page rests on.
 *
 * While coord answers that its ledger tables are absent (`{available: false}`),
 * that it does not serve the route, or that the route is switched off, every
 * ledger figure on the page is UNKNOWN for the same reason. Saying so in each
 * section — the strip, every "Last spawned" cell, the counts, the chart —
 * repeats one sentence a dozen times (served policy `ux-priorities`
 * `repeated-chrome-must-earn-its-space-by-varying`), so the page states it ONCE
 * and collapses the sections under that statement (`LedgerUnservedNotice`).
 *
 * A read that FAILED (a 502, a deadline, a refusal) is not this: the ledger is
 * served and the page keeps its per-section arms and its last good read.
 */

import type { SpawnLedgerRead } from "./useSpawnLedger";
import type { SpawnReadIssue } from "./spawnStatus";

/** The issues that mean coord does not serve the ledger, rather than that a read failed. */
export const LEDGER_UNSERVED_KINDS: ReadonlySet<SpawnReadIssue["kind"]> =
  new Set(["ledger_not_deployed", "route_unavailable", "route_disabled"]);

/**
 * The issue saying coord does not serve the ledger, or `null` when it is
 * served (or not yet known not to be). Both the window's list and the stats
 * must hold nothing: a page with a last good read keeps showing it.
 */
export function ledgerUnserved(
  ledger: Pick<SpawnLedgerRead, "list" | "stats">
): SpawnReadIssue | null {
  const issue = ledger.list.issue;
  if (issue === null || !LEDGER_UNSERVED_KINDS.has(issue.kind)) return null;
  if (ledger.list.data !== null || ledger.stats.data !== null) return null;
  return issue;
}
