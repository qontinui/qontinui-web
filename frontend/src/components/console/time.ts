/**
 * time — the two timestamp formatters the console renders through.
 *
 * Supports **R2** (a record row's time slot) — see
 * `frontend/docs/console-ui-style-guide.md` §2 R2 and §3.1.
 *
 * These lived in `components/operations/utils.ts`. That module is 730 lines and
 * is NOT a neutral util bag: it is the merge-train ROUTE CATALOGUE
 * (`OPERATIONS_API`, `GATES_LIST_API`, `SYMBOL_CLAIMS_API`, ~30 URL builders,
 * the poll-cadence constants) with a runtime dependency on
 * `@/services/api-config`. Importing it from `console/statusRow.tsx` was a
 * runtime edge from the base layer into a feature layer, and it made the
 * barrel's own claim — *"nothing here fetches, polls, or knows a route"* —
 * false by exactly one import.
 *
 * So `relativeTime` MOVED here (28 pure lines, no imports) rather than the
 * whole catalogue moving anywhere. `operations/utils.ts` re-exports it, so all
 * 33 existing importers are untouched — the same shim pattern this plan
 * applies to `statusRow` and `CollapsiblePanel`. `console/` now has **zero**
 * runtime dependency on `operations/`; keep it that way.
 */

/**
 * Convert an ISO timestamp to a human-friendly relative string.
 * e.g. "3s ago", "2m ago", "1h ago", "3d ago"
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";

  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Absolute local timestamp for a `title` — "unknown" reads better than "". */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "time unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "time unknown" : d.toLocaleString();
}
