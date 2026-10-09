// ============================================================================
// Operations Page Utility Helpers
// ============================================================================

/**
 * Polling fallback interval (ms) when the CI-status WS is offline.
 * Matches `DEVICE_STATUS_POLL_FALLBACK_MS` — CI status changes at
 * webhook cadence, so 5s is fresh enough without hot-looping coord.
 */
export const CI_STATUS_POLL_FALLBACK_MS = 5_000;

/**
 * Polling interval for the stuck-PR recovery panel (ms). A wedge is a
 * minutes-to-hours condition and each poll costs coord a nudge scan, so 30s is
 * fresh enough to reflect a remediation without hot-looping the proxy.
 */
export const STUCK_PR_POLL_MS = 30_000;

/**
 * Maximum stuck PRs the recovery panel renders at once. A repo with 30 wedged
 * PRs has a systemic problem, not 30 individual ones — the panel says so
 * rather than rendering 30 diagnosis cards.
 */
export const STUCK_PR_MAX_CARDS = 6;

/**
 * How many candidates the panel reads a merge verdict for per poll.
 *
 * Deliberately ABOVE {@link STUCK_PR_MAX_CARDS}: the verdict is what retracts a
 * candidate the age screen caught but that turns out to be moving normally, and
 * every retraction promotes the next candidate into view. Reading exactly
 * `STUCK_PR_MAX_CARDS` would leave a promoted card with no verdict — and, since
 * the fused list is the same on the next poll, permanently stuck on "merge
 * attempt not read yet". The headroom covers the retractions without letting a
 * repo with 30 wedged PRs turn one poll into 30 reads.
 */
export const STUCK_PR_MAX_VERDICT_READS = STUCK_PR_MAX_CARDS + 4;

/**
 * Polling interval for `useSymbolClaimsStream` in milliseconds.
 * Coord defaults `Symbol` claims to 300s TTL; 30s polling is fresh
 * enough to surface edits within ~1 frame and slow enough to keep
 * coord's Redis SCAN budget unbothered. A WS push channel is a
 * follow-up — symbol claims churn at human-typing cadence, not the
 * sub-second cadence that justified WS for device_status.
 */
export const SYMBOL_CLAIMS_POLL_MS = 30_000;

/** Maximum symbol claims to render per machine in the MachineCard
 *  sub-line. Anything beyond is summarized with a "+N more" indicator. */
export const SYMBOL_CLAIMS_TOP_N = 5;

/** Maximum visible length of an extracted symbol name in the sub-line.
 *  Longer names get truncated with an ellipsis to keep the card stable. */
export const SYMBOL_NAME_MAX_LEN = 30;

/**
 * Extract the symbol name from a `<repo>:<file>:<symbol>` resource_key.
 *
 * Per the qontinui-supervisor `symbol_watcher` convention, the symbol
 * name is the LAST colon-separated component. Windows paths in the
 * `file` segment can contain backslashes but never colons (colons in
 * Windows paths are only legal as the drive separator at position 1,
 * which the daemon canonicalizes out), so split-by-`:` is unambiguous.
 *
 * Falls back to the full resource_key when there's no colon — defensive
 * against bad upstream data, never crashes the render path.
 */
export function extractSymbol(resourceKey: string): string {
  const idx = resourceKey.lastIndexOf(":");
  const name = idx === -1 ? resourceKey : resourceKey.slice(idx + 1);
  if (name.length <= SYMBOL_NAME_MAX_LEN) return name;
  // U+2026 HORIZONTAL ELLIPSIS keeps the visual width tight.
  return name.slice(0, SYMBOL_NAME_MAX_LEN - 1) + "…";
}

/** Default number of recent dev actions to request. */
export const DEV_ACTIONS_LIMIT = 50;

/**
 * Polling interval for `useDevActionsStream` (ms). Dev actions land at
 * agent-execution cadence; 10s matches the fleet-health poll and is fresh
 * enough for an operator watching the ledger without hot-looping coord.
 */
export const DEV_ACTIONS_POLL_MS = 10_000;

/**
 * Polling interval for the migration queue (ms). Reservations change at
 * author/merge cadence (a slot is taken, a PR binds, a merge flips it) —
 * 15s surfaces a transition promptly without hot-looping coord, matching
 * the gates-panel cadence.
 */
export const MIGRATIONS_QUEUE_POLL_MS = 15_000;

/** Polling interval in milliseconds. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Polling fallback interval when the device-status WS is offline.
 * 5s matches the existing fleet-status polling cadence — slow enough
 * that polling N tenants doesn't hot-loop coord, fast enough that a
 * disconnected operator sees fresh data within one display refresh.
 */
export const DEVICE_STATUS_POLL_FALLBACK_MS = 5_000;

/**
 * Convert an ISO timestamp to a human-friendly relative string.
 * e.g. "3s ago", "2m ago", "1h ago", "3d ago"
 *
 * MOVED to `@/components/console/time` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1, and
 * re-exported here so all **23** existing importers are untouched (13 via
 * `@/components/operations/utils`, 10 via `./utils`). It moved because the
 * console primitives need it and this module is the merge-train route
 * catalogue — a `console/` → `operations/` runtime edge for one pure 28-line
 * formatter. NEW code imports it from `@/components/console`.
 *
 * The private copies that were NOT in that 23 — invisible to this re-export
 * because they imported nothing — have since been folded onto the primitive by
 * Phase 1's post-merge follow-up. `console/time.ts`'s module doc carries the
 * list and the one file that stayed behind (a same-name, different-behaviour
 * formatter, not a copy).
 *
 * `relativeTime` now takes an options bag (`{ absent, now }`). This is a
 * **binding** re-export, so that signature travels to every importer here and
 * a zero-argument call is unchanged.
 */
export { relativeTime } from "@/components/console/time";

/**
 * Chronological comparison of two RFC3339 stamps.
 *
 * NOT a string compare: coord serialises `DateTime<Utc>` with chrono's default,
 * whose fractional-second width varies (0/3/6/9 digits), so lexicographic order
 * is not chronological — `…59.999500Z` sorts BEFORE `…59.999Z`. That is enough
 * to pick the wrong driver proposal in a tie-break.
 *
 * **It lives here rather than in one consumer because it has been the right
 * answer twice and the wrong one once.** It was private to `trainActivity.ts`
 * (pinned by that module's "orders proposals chronologically, not
 * lexicographically" test), and `gateDecision.ts` — a new file in the same
 * directory, picking the newest of two coord rows for the same reason —
 * reached for `a.at > b.at` instead, because there was nothing importable to
 * reach for. Review measured the cost: across the three widths coord can emit,
 * a `Z`-suffixed pair inverts on 28 of 156 ordered pairs spanning one second.
 *
 * The `+00:00` offset form chrono's `to_rfc3339()` produces happens to be
 * safe under string compare (`+` sorts below every digit, so a short fraction
 * compares as zero-padded), which is exactly why the bug survives review by
 * inspection: it is correct against today's producer and wrong against the
 * serde default, and both reach this frontend.
 *
 * One honest limit: `Date.parse` truncates to milliseconds, so `…59.999Z` and
 * `…59.999500Z` compare EQUAL rather than ordering. That degrades to "keep the
 * row already held", which is a stable tie-break — not an inversion.
 */
export function isAfter(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b;
  return ta > tb;
}

/**
 * Format a stall age (seconds) as a compact human label, e.g. "45s", "12m",
 * "3h", "2d". Used by the Phase 5 device-tile stalled badge, which receives
 * the age as a precomputed `stall_age_secs` from coord (not a timestamp), so
 * `relativeTime` doesn't apply.
 */
export function formatStallAge(secs: number | null | undefined): string {
  if (secs == null || Number.isNaN(secs) || secs < 0) return "0s";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ---------------------------------------------------------------------------
// Volume free space (disk monitoring, Phase 1)
// ---------------------------------------------------------------------------
//
// Plan `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 1. Reads
// coord's `worktree_volume` head through the web proxy — no alembic migration
// ships with this phase, and web never touches coord's Postgres schema.

/**
 * Age at which a volume reading stops being presented as current.
 *
 * The runner publishes on a short tick (Phase 1 step 1 targets 60s), so a
 * reading older than 5 minutes means the publisher missed several ticks. It is
 * still SHOWN — with its age — because a stale number plus its age is
 * information, whereas hiding it would be indistinguishable from "no disks".
 */
export const VOLUME_STALE_AFTER_MS = 5 * 60_000;

/**
 * Free-space bands, in bytes. These are the runner's existing thresholds
 * (`census.rs` `COORD_LOW_DISK_WARN_BYTES` / `COORD_LOW_DISK_CRIT_BYTES`:
 * 100 GiB warn, 25 GiB crit), promoted here so the dashboard colours agree
 * with the log-side warning rather than inventing a second opinion. Phase 3
 * replaces both with per-device configuration.
 */
export const VOLUME_WARN_FREE_BYTES = 100 * 1024 ** 3;
export const VOLUME_CRIT_FREE_BYTES = 25 * 1024 ** 3;

/** Severity band for a volume's free space. */
export type VolumeSeverity = "ok" | "warn" | "critical";

/**
 * Band a volume's free space, or `null` when there is nothing to band.
 *
 * A non-finite input (`NaN` from a byte count that did not arrive as a number,
 * `Infinity`) has NO severity. It must not fall through the `<` comparisons
 * into the `"ok"` arm: both `NaN < CRIT` and `NaN < WARN` are false, so the
 * naive form returns green — a fabricated "healthy" badge for a volume that was
 * never measured, which is exactly the render this feature exists to remove.
 * The hazard is fixed HERE rather than at each call site, because the next
 * consumer of this shared helper is the one that forgets to guard.
 */
export function volumeSeverity(freeBytes: number): VolumeSeverity | null {
  if (!Number.isFinite(freeBytes)) return null;
  if (freeBytes < VOLUME_CRIT_FREE_BYTES) return "critical";
  if (freeBytes < VOLUME_WARN_FREE_BYTES) return "warn";
  return "ok";
}

const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/**
 * Format a byte count with BINARY units (KiB/GiB/TiB), which is what the
 * thresholds above are expressed in and what Windows' own "GB" actually means.
 * Labelling them `GiB` removes the ambiguity rather than papering over it.
 *
 * Returns `"unknown"` for a non-finite or negative input — a value that could
 * not be computed says so instead of rendering as `0 B`.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "unknown";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Sub-unit values keep one decimal; bytes stay integral.
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${BINARY_UNITS[unit]}`;
}

/**
 * Percentage of a volume that is FREE, rounded to one decimal. Returns `null`
 * when the total is unusable (0, negative, non-finite) — a percentage that
 * cannot be computed must render as "unknown", never as 0 %.
 */
export function percentFree(
  freeBytes: number,
  totalBytes: number
): number | null {
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes)) return null;
  if (totalBytes <= 0 || freeBytes < 0) return null;
  return Math.round((freeBytes / totalBytes) * 1000) / 10;
}

/**
 * Age of a reading in milliseconds, or `null` when it cannot be computed
 * (absent/unparseable timestamp). A future timestamp clamps to 0 rather than
 * going negative — clock skew is not evidence of freshness, but it is also not
 * evidence of staleness.
 */
export function readingAgeMs(
  observedAt: string | null | undefined
): number | null {
  if (!observedAt) return null;
  const then = new Date(observedAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Date.now() - then);
}

/**
 * Truncate a string to `maxLen` characters, appending an ellipsis if needed.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

// ---------------------------------------------------------------------------
// Gate clearance provenance (plan
// `2026-07-27-configurable-gate-clearance-authority` Phase 6)
// ---------------------------------------------------------------------------

/**
 * The clearance-provenance fields coord stamps when a gate reaches a terminal
 * verdict (columns added by web migration `gates_clearance_provenance_01`).
 * Every field is optional + nullable: a coord predating the provenance deploy
 * omits them all, and the summary is simply not rendered.
 */
export interface ClearanceProvenance {
  /** Which door moved the gate: `operator_route | agent_attest | agent_reject
   *  | withdraw | force_clear | sweep` (free text — future values render). */
  cleared_via?: string | null;
  /** Device UUID of the caller that moved the gate. */
  cleared_by_device_id?: string | null;
  /** Agent UUID of the caller (agent-token sessions only). */
  cleared_by_agent_id?: string | null;
  /** `policy_rules.policy_id` of the `gate_clearance` rule that authorized
   *  the action; null for operator routes and the no-rule defaults. */
  cleared_under_rule?: string | null;
}

/** Verb rendered for each known `cleared_via` door. Unknown non-null values
 *  degrade to "cleared via <value>" — never a crash, never a hidden row. */
const CLEARED_VIA_VERBS: Record<string, string> = {
  operator_route: "cleared by operator",
  agent_attest: "attested",
  agent_reject: "rejected",
  withdraw: "withdrawn",
  force_clear: "force-cleared",
  sweep: "cleared by sweep",
};

/** The agent-facing doors — the only ones that run a clearance-authority
 *  resolution, so the only ones for which "no rule" means "the audience
 *  default decided" rather than "no resolution happened". */
const AGENT_CLEARANCE_DOORS: ReadonlySet<string> = new Set([
  "agent_attest",
  "agent_reject",
]);

/**
 * Optional band annotation for the deciding `gate_clearance` rule. NOT on the
 * wire — the caller derives it by looking `cleared_under_rule` up in the
 * tenant's current rule set (see `admin/coord/_shared/clearanceRuleBand.ts`).
 * Omit it and the sentence renders exactly as it did before this option
 * existed.
 */
export interface ClearanceProvenanceOptions {
  /** `"tenant"` / `"system"` when the deciding rule was found in the current
   *  rule set; `"unknown"` when the set WAS read and no longer carries the id.
   *  `null`/omitted — including "the set was never read" — renders the
   *  un-annotated "under rule <id>", which claims nothing either way. */
  ruleBand?: "tenant" | "system" | "unknown" | null;
  /** When true AND the door is an agent door that carries no rule, say so:
   *  the built-in audience default decided, which is a real answer rather than
   *  a missing one. Opt-in so existing callers render byte-identically. */
  noteAudienceDefault?: boolean;
}

/** How each band is spelled in the sentence. */
const RULE_BAND_PHRASES: Record<"tenant" | "system" | "unknown", string> = {
  tenant: "under tenant rule",
  system: "under system default rule",
  // Deliberately not a band — the caller could not establish one, and
  // guessing "tenant" here is exactly the mis-diagnosis this cell exists to
  // prevent.
  unknown: "under rule",
};

/** UUID → 8-char short form for display (full value belongs in a title). */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Human-readable clearance-provenance sentence, e.g.
 * `"attested by agent 6f2a91c3 on 1b2c3d4e under rule 9e8d7c6b"`.
 *
 * Composes from whichever fields are present (each independently optional —
 * a device-JWT clearance has no agent id; operator routes have no rule).
 * Returns `null` when NO provenance field is set, so callers can render
 * nothing — the panel must look identical to today against a coord that does
 * not emit the columns yet.
 *
 * `opts` adds the band of the deciding rule ("tenant rule" / "system default
 * rule" / an explicit "band unknown") and, on an agent door with no rule, the
 * "no rule matched — audience default" statement. Both are opt-in: called with
 * one argument this function is byte-identical to its pre-`opts` behaviour.
 */
export function summarizeClearanceProvenance(
  p: ClearanceProvenance,
  opts?: ClearanceProvenanceOptions
): string | null {
  const via = p.cleared_via ?? null;
  const agent = p.cleared_by_agent_id ?? null;
  const device = p.cleared_by_device_id ?? null;
  const rule = p.cleared_under_rule ?? null;
  if (!via && !agent && !device && !rule) return null;

  const verb = via
    ? (CLEARED_VIA_VERBS[via] ?? `cleared via ${via}`)
    : "cleared";
  const parts: string[] = [verb];
  if (agent) parts.push(`by agent ${shortId(agent)}`);
  if (device) {
    // "on <device>" when the sentence already names an actor (an agent id, or
    // a verb that itself says "by …" — operator/sweep); "by <device>" only
    // when the device IS the actor. Avoids "cleared by operator by <id>".
    const actorNamed = agent !== null || verb.includes(" by ");
    parts.push(actorNamed ? `on ${shortId(device)}` : `by ${shortId(device)}`);
  }
  if (rule) {
    // No band supplied → the un-annotated phrase, identical to today. An
    // explicit "unknown" is a different statement (the set was read and the
    // rule is gone) and is called out.
    // `?? "unknown"` picks the LOOKUP KEY for the un-annotated phrase ("under
    // rule <id>"); it is not a claim that the band is unknown. The explicit
    // "(band unknown)" suffix below fires only when the caller actually said
    // so — i.e. it read the rule set and the rule was not in it.
    const band = opts?.ruleBand ?? "unknown";
    parts.push(`${RULE_BAND_PHRASES[band]} ${shortId(rule)}`);
    if (opts?.ruleBand === "unknown") parts.push("(band unknown)");
  } else if (
    opts?.noteAudienceDefault &&
    via &&
    AGENT_CLEARANCE_DOORS.has(via)
  ) {
    parts.push("— no clearance rule matched (audience default)");
  }
  return parts.join(" ");
}
