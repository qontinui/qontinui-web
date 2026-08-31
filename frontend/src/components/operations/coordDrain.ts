/**
 * The pure half of the "Pause coord dispatch" control — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 1.
 *
 * ## Why this control is NOT called "Disable"
 *
 * Coord's drain map (`coord.fleet_runtime_policy.drain`) is read by exactly
 * two selectors, both of them coord's own dispatch: `ci_dispatch.rs` and
 * `build_dispatcher.rs`. Measured against `qontinui-coord` `origin/main` on
 * 2026-08-31, it is read by nothing else. Three consequences, and every one of
 * them has to be on screen beside the button:
 *
 *  1. **GitHub Actions routing is unaffected.** GitHub matches a job's
 *     `runs-on: [self-hosted, qontinui]` against the runner's LABEL set, which
 *     coord's drain map is invisible to. A paused host still draws CI jobs.
 *     Removing the `qontinui` label is the lever that changes this, and it is
 *     Phase 4 of the plan — blocked on a GitHub App `administration:write`
 *     grant no agent can obtain.
 *  2. **Agent-session spawning is unaffected.** `agents_spawn.rs` and
 *     `spawn_authorization.rs` reference the drain map zero times, and
 *     `PICK_ONLINE_DEVICE_SQL` filters only on the tenant binding,
 *     `last_seen_at` freshness and the `ci_runner` capability exclusion. A
 *     paused host can still have sessions spawned into it.
 *  3. **The merge-train slot clamp is unaffected.** Neither
 *     `merge_scheduler.rs` nor `device_state.rs` references `fleet_drain`, so a
 *     paused machine still counts toward `effective_slot_cap`.
 *
 * A row labelled "Disable" that leaves all three standing would have been
 * useless in the incident this plan was written from — the operator would have
 * clicked it, believed the host was out of the pool, and watched it keep
 * destroying CI jobs. The copy below is therefore load-bearing, not decoration,
 * and it lives in this module so the same sentences reach the explanatory text,
 * the confirm dialog and the tests without a second copy to drift.
 *
 * ## Why current drain state is not shown
 *
 * Coord exposes **no read** of the drain map over HTTP. `POST
 * /coord/fleet/{drain,undrain}` return the resulting `DrainResponse`, and
 * `fleet_drain.rs` has no GET handler at all — `/coord/fleet/health`,
 * `/coord/fleet-policy` and the CI-runner mirror all omit it. So the honest
 * rendering on page load is UNKNOWN, never "not paused"
 * (`[policy: silent-empty-is-unknown]`). What this session's own writes
 * returned IS known and is shown; the durable record of who paused what and
 * when is the operator audit feed (Phase 5).
 */

/** Coord's `MAX_DRAIN_DAYS` — `fleet_drain.rs`. A longer window is a 400. */
export const MAX_DRAIN_DAYS = 30;

/** Coord's `DrainResponse`, shared by both routes. */
export interface DrainResponse {
  device_id: string;
  drained: boolean;
  until: string | null;
  reason: string | null;
  drained_by: string | null;
  drained_at: string | null;
  /**
   * The `coord.fleet_runtime_policy_versions` version this write produced, or
   * the existing version when the request was a no-op. `null` when there is no
   * policy row at all.
   */
  version: number | null;
  /**
   * `false` when the request changed nothing — an undrain of a device that was
   * not paused. Coord reports it rather than dressing it up as a successful
   * release, and so does this control: "it was not paused" and "I released it"
   * are different facts.
   */
  changed: boolean;
}

/** One selectable expiry window. */
export interface DrainWindow {
  /** Stable form value / test id suffix. */
  id: string;
  label: string;
  hours: number;
}

/**
 * The offered expiry windows.
 *
 * There is no "indefinite" option and there cannot be one: coord's
 * `DrainRequest::until` is a non-`Option` field precisely so that a pause
 * cannot become a permanent removal nobody remembers making. The longest
 * option is coord's own ceiling; re-pausing is one click.
 */
export const DRAIN_WINDOWS: readonly DrainWindow[] = [
  { id: "1h", label: "1 hour", hours: 1 },
  { id: "4h", label: "4 hours", hours: 4 },
  { id: "12h", label: "12 hours", hours: 12 },
  { id: "24h", label: "24 hours", hours: 24 },
  { id: "3d", label: "3 days", hours: 72 },
  { id: "7d", label: "7 days", hours: 168 },
  { id: "30d", label: `${MAX_DRAIN_DAYS} days (coord's maximum)`, hours: 720 },
];

/** The default selection — long enough to survive a night, short enough that
 * forgetting about it is self-correcting. */
export const DEFAULT_DRAIN_WINDOW_ID = "4h";

/**
 * The window an id names, or the shortest one.
 *
 * Total by construction: `DRAIN_WINDOWS` is non-empty and the fallback is its
 * first (shortest) entry, so an id from a stale bookmark or a future rename can
 * only ever produce a SHORTER pause than the operator asked for — never a
 * longer one, and never a crash on a control whose whole job is to be reachable
 * in an incident.
 */
export function resolveDrainWindow(id: string): DrainWindow {
  const found = DRAIN_WINDOWS.find((w) => w.id === id);
  // `DRAIN_WINDOWS` is a non-empty literal; the assertion documents that rather
  // than inviting a runtime guard for a case the type system cannot express.
  return found ?? (DRAIN_WINDOWS[0] as DrainWindow);
}

/**
 * The RFC 3339 instant a window of `hours` from `nowMs` expires at.
 *
 * Always emitted with the `Z` offset: coord parses `until` as
 * `DateTime<Utc>`, and a string with no offset would be read as UTC whatever
 * the operator's zone, silently moving the deadline.
 */
export function drainUntilIso(nowMs: number, hours: number): string {
  return new Date(nowMs + hours * 3_600_000).toISOString();
}

/**
 * The three sentences that must appear wherever this control appears.
 *
 * Returned as data rather than JSX so the explanatory paragraph on the card and
 * the confirm dialog (which can only be a plain string) render the SAME words
 * from the SAME call. That is the property the plan asks for — "explanatory text
 * that tracks the control so copy and effect cannot disagree" — and it is only
 * a property while there is one copy of the sentences.
 */
export function drainScopeSentences(hostname: string): readonly string[] {
  return [
    `Coord stops sending ${hostname} CI-dispatch and build-dispatch work.`,
    "GitHub Actions routing is UNCHANGED — this host still draws " +
      "[self-hosted, qontinui] jobs, because GitHub matches on the runner's " +
      "labels and coord's drain map is invisible to it.",
    "Agent sessions can still be spawned into it, and it still counts toward " +
      "the merge-train slot cap — neither reads the drain map.",
  ];
}

/**
 * The confirm text for a pause, naming the blast radius and the expiry.
 *
 * `untilIso` is rendered as the browser's local string because the operator
 * has to recognise "is that tonight or next week?" at a glance, and an ISO
 * string in UTC is the format that reads correctly and is misread anyway.
 */
export function drainConfirmText(hostname: string, untilIso: string): string {
  const when = new Date(untilIso);
  const local = Number.isNaN(when.getTime()) ? untilIso : when.toLocaleString();
  return [
    `Pause coord dispatch to ${hostname} until ${local}.`,
    "",
    ...drainScopeSentences(hostname),
    "",
    "The pause expires by itself at that time. Proceed?",
  ].join("\n");
}

/** The confirm text for a release. */
export function undrainConfirmText(hostname: string): string {
  return [
    `Resume coord dispatch to ${hostname}.`,
    "",
    "Coord may send this machine CI-dispatch and build-dispatch work again, immediately.",
    "",
    "Proceed?",
  ].join("\n");
}

/**
 * One sentence describing what a completed write actually did.
 *
 * The `changed: false` arm is the reason this exists: coord writes no audit
 * side effects when nothing changed, so a release that released nothing must
 * not report itself as a release.
 */
export function describeDrainResult(res: DrainResponse): string {
  // `changed: false` has exactly ONE shape on the wire. Coord's no-op arm
  // hardcodes `drained: false` (`fleet_drain.rs`), and a repeat DRAIN can never
  // be a no-op because the entry carries `drained_at: now`, which moves the
  // JSONB value on every call. So "already paused, unchanged" is unreachable
  // and is deliberately not written here — a branch no response can produce is
  // a claim nothing tests.
  if (!res.changed) {
    return "No change — this machine was not paused, so there was nothing to release.";
  }
  if (res.drained) {
    const until = res.until ? new Date(res.until) : null;
    const when =
      until && !Number.isNaN(until.getTime())
        ? until.toLocaleString()
        : (res.until ?? "an unreported time");
    return `Paused. Coord dispatch is held until ${when}${
      res.drained_by ? `, by ${res.drained_by}` : ""
    }${res.version != null ? ` (policy version ${res.version})` : ""}.`;
  }
  return `Released. Coord may dispatch to this machine again${
    res.version != null ? ` (policy version ${res.version})` : ""
  }.`;
}

/**
 * Local refusal for a blank reason.
 *
 * Coord requires a non-blank `reason` and the audit row is the entire reason
 * this goes through coord rather than a shell, so a blank one is refused here
 * rather than surfaced as a 400 from two services away.
 */
export function reasonRefusal(reason: string): string | null {
  return reason.trim().length === 0 ? "Reason is required." : null;
}
