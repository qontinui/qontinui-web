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
 * **23** existing importers are untouched (13 via
 * `@/components/operations/utils`, 10 via `./utils`; no namespace imports, and
 * `operations/index.ts` does not re-export it) — the same shim pattern this
 * plan applies to `statusRow` and `CollapsiblePanel`. No shipped module under
 * `console/` has any runtime dependency on `operations/`; keep it that way.
 *
 * **This is NOT every caller of a function shaped like this one.** Six more
 * files declare their OWN `relativeTime` and import nothing, so they are
 * invisible to the shim and untouched by this move — later-wave debt, and
 * exactly the duplicate-helper defect this plan is chartered to remove:
 * `admin/agent-claims/AgentClaimsDashboard.tsx`,
 * `admin/agent-sessions/AgentSessionsDashboard.tsx`,
 * `admin/coord/TreeCard.tsx`,
 * `admin/prompt-injections/PromptInjectionsDashboard.tsx`,
 * `execute/ScheduleListItem.tsx`, `sessions/LineageTimeline.tsx` (plus
 * `operations/gatesPredicate.ts`'s `relativeAgo`, a same-shape copy under
 * another name, self-disclosed in its own comment). The first three are named
 * in this guide's own scope as surfaces this plan unifies — migrate them onto
 * this module as their wave reaches them, and do not read "23" as "all of
 * them".
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
