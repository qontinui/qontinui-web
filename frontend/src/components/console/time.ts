/**
 * time — the two timestamp formatters the console renders through.
 *
 * Supports **R2** (a record row's time slot) — see
 * `frontend/docs/console-ui-style-guide.md` §2 R2 and §3.1.
 *
 * These lived in `components/operations/utils.ts`. That module is 730 lines and
 * is NOT a neutral util bag: it is the merge-train ROUTE CATALOGUE
 * (`OPERATIONS_API`, `SYMBOL_CLAIMS_API`, ~30 URL builders,
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
 * **The private-copy debt this module was created to absorb is now paid.**
 * Phase 1 disclosed six files that declared their OWN `relativeTime` and
 * imported nothing, so they were invisible to the shim and untouched by the
 * move. Migrating them needed two things this module did not offer, which is
 * *why* they were copies rather than callers, and both now exist:
 *
 * 1. **An injectable clock** (`options.now`). Without it a caller cannot write
 *    a deterministic test, which is the reason `operations/gatesPredicate.ts`
 *    stated in its own comment for keeping `relativeAgo`.
 * 2. **A caller-chosen absent placeholder** (`options.absent`). The console
 *    renders `never`; the agent dashboards render `—`. A shared formatter that
 *    hard-codes one of them can only ever serve half its callers.
 *
 * Migrated onto this module: `admin/agent-claims/AgentClaimsDashboard.tsx`,
 * `admin/agent-sessions/AgentSessionsDashboard.tsx`,
 * `admin/prompt-injections/PromptInjectionsDashboard.tsx`,
 * `sessions/LineageTimeline.tsx` (four byte-identical copies) and
 * `operations/gatesPredicate.ts`'s `relativeAgo`. `admin/coord/TreeCard.tsx`
 * was deleted by Phase 3.
 *
 * **One named file deliberately did NOT migrate.**
 * `execute/ScheduleListItem.tsx` is a same-NAME, different-BEHAVIOUR function:
 * it rounds rather than floors and renders future stamps as `in 5m`. Folding it
 * in would change what that surface displays, so it stays where it is. Phase 1
 * listed it as a duplicate; it is not one, and this correction is the reason
 * the count here is five and not six.
 */

/** Caller-supplied knobs for {@link relativeTime}. Both are optional and both
 *  default to what the console itself renders, so an existing call site that
 *  passes nothing is unaffected. */
export interface RelativeTimeOptions {
  /**
   * What to render when there is no usable timestamp — absent, or present but
   * unparseable. Defaults to `"never"`, which is what every `/admin/coord/*`
   * surface renders; the agent dashboards pass `"—"` and
   * `gatesPredicate` passes `"an unknown time ago"`.
   */
  absent?: string;
  /**
   * The clock, in epoch milliseconds. Defaults to `Date.now()`. Exists so a
   * caller can render deterministically under test without stubbing global
   * time — the absence of this knob is why `operations/gatesPredicate.ts` kept
   * a private copy.
   */
  now?: number;
}

/**
 * Convert an ISO timestamp to a human-friendly relative string.
 * e.g. "3s ago", "2m ago", "1h ago", "3d ago"
 *
 * **An unparseable timestamp renders as `absent`, not as a duration.** It used
 * to share the `"just now"` branch with a negative delta, which reported a
 * parse failure as the calmest possible reading — the `silent-empty-is-unknown`
 * mistake applied to a clock. The two cases only ever looked alike because
 * `NaN < 0` is false.
 *
 * **Any negative delta is still `"just now"`** — not only a stamp that is
 * genuinely in the future. Sub-second server/browser clock skew lands here far
 * more often than a real future timestamp does, and for both the honest reading
 * is that the event is about now.
 */
export function relativeTime(
  iso: string | null | undefined,
  options: RelativeTimeOptions = {}
): string {
  const absent = options.absent ?? "never";
  if (!iso) return absent;

  const now = options.now ?? Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs)) return absent;
  if (diffMs < 0) return "just now";

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
