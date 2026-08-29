/**
 * alertStatus — pure status derivation for `coord.alerts` rows.
 *
 * Plan `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`, SHARED UI
 * CONVENTIONS: "Status derivation lives in a pure, unit-tested module". This
 * is the Alerts tab's `prPipeline.ts` — it maps a coord alert row to
 * `{ kind, label, reason, attention }` in PLAIN LANGUAGE, with no rendering,
 * so the copy an operator reads is testable without a DOM.
 *
 * Three contracts it exists to hold:
 *
 * 1. **`ATTENTION_BY_KIND` is TOTAL** over `AlertKind`, and a unit test
 *    enforces the totality. That is what stops a newly-added alert kind from
 *    rendering with no attention semantics — precisely how the page's old
 *    hardcoded 4-value `KINDS` list rotted until it matched almost nothing in
 *    a 1643-row corpus.
 * 2. **No UUID ever reaches the default view.** `alert_key` is a dedup
 *    identity, never a display string, and coord's own `summary` strings
 *    interpolate `device_id` (`"primary tree {device_id}/{repo} …"`), so every
 *    string this module returns goes through {@link stripUuids}. A unit test
 *    asserts it.
 * 3. **An unrecognised kind degrades, it does not crash.** The API now serves
 *    the kind vocabulary dynamically, so this module must render a kind it has
 *    never seen — as `unknown`, with attention derived from the row's severity
 *    rather than silently calm.
 *
 * The `Attention` vocabulary is imported rather than redeclared, so the merge
 * pipeline and the alerts tab read identically. It comes from
 * `@/components/console/attention` — the base layer that DECLARES it — not from
 * `prPipeline`, which merely re-exports it for compatibility. Reaching through
 * the merge-train derivation for a two-word type was the last such edge left in
 * the tree; the other sixteen modules already take the direct one.
 */

import {
  type Attention,
  escalateAttention,
} from "@/components/console/attention";

export type { Attention };

/**
 * The shape of one `coord.alerts` row as the web proxy serves it.
 *
 * `alert_key` is present because it is the row's DEDUP IDENTITY (the React key,
 * the thing coord upserts on) — it is deliberately NOT a display string.
 */
export interface CoordAlertRow {
  id?: number | string;
  alert_key: string;
  severity?: string;
  /** Coord's raw `coord.alerts.kind` — a machine vocabulary, never displayed. */
  kind?: string;
  device_id?: string | null;
  summary?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  occurrences?: number;
  resolved_at?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * The DERIVED status vocabulary — one entry per family of coord alert kinds,
 * named for what an operator would call it rather than for the watcher that
 * produced it. Coord's raw `kind` strings map onto these via
 * {@link classifyAlertKind}.
 */
export type AlertKind =
  /** A primary checkout is behind / dirty — `stale_primary_tree`. */
  | "stale-tree"
  /** Uncommitted work sitting idle — `stale_wip`, `orphaned_wip`. */
  | "stale-wip"
  /** A git ref-lifecycle invariant is contradicted — `git_inv-*`. */
  | "git-invariant"
  /** Reclaimable disk held by worktree copies — `worktree_unjunctioned`. */
  | "worktree-waste"
  /** A volume is near full — `worktree_disk_danger`. */
  | "disk-danger"
  /** A repo's main branch is red — `red_main`. */
  | "red-main"
  /** An auth/identity configuration contradiction — `auth_*`. */
  | "auth-config"
  /** The merge train cannot move a PR — the `pr_merge_*` family. */
  | "merge-stuck"
  /** A machine or the fleet link is unhealthy — `machine_*`, `fleet_*`. */
  | "machine-health"
  /** A coord gate reached a verdict it can never clear from — `gate_*`. */
  | "gate-stuck"
  /** A gate is open and coord still owes it a tick — `gate_*`. */
  | "gate-pending"
  /** Coord's land bookkeeping disagrees with GitHub — `coord_lost_land`, … */
  | "land-integrity"
  /** A git ref could not be mirrored or replicated — `mirror_*`, `git_*`. */
  | "replication"
  /** An agent session is heartbeat-stale or unreachable — `session_*`. */
  | "session-health"
  /** A setting is armed but not actually in force — `config_*`. */
  | "config-drift"
  /** What is being served disagrees with what should be — `route_*`. */
  | "serving-drift"
  /** Derived data has not caught up with its source — `memory_*`. */
  | "backfill-gap"
  /** The row has been resolved; kept visible only by the toggle. */
  | "resolved"
  /** A kind this build has never seen. NOT an error — see the module doc. */
  | "unknown";

/**
 * The audited kind → attention table. TOTAL over {@link AlertKind}, enforced
 * by a unit test, and the single authority for the badge palette (`author` →
 * red, `waiting` → amber, `none` → neither).
 *
 * The audit, one line per kind — the question is always "must a human act NOW,
 * or will something else clear this?":
 *
 * | kind            | why it fires                              | act now? |
 * |-----------------|-------------------------------------------|----------|
 * | stale-tree      | checkout behind/dirty; only a pull fixes it| YES     |
 * | stale-wip       | uncommitted work ages out and gets lost    | YES     |
 * | git-invariant   | a ref contradicts coord's own bookkeeping  | YES     |
 * | disk-danger     | a volume is about to fill                  | YES     |
 * | red-main        | every PR in the repo is frozen             | YES     |
 * | auth-config     | an identity contradiction fails closed     | YES     |
 * | merge-stuck     | the train will not move this PR unaided    | YES     |
 * | replication     | a ref will not mirror; RPO-0 is at risk    | YES      |
 * | land-integrity  | coord and GitHub disagree that a PR landed | YES      |
 * | gate-stuck      | the gate reached a verdict it cannot leave | YES      |
 * | config-drift    | a setting is set but is NOT in force       | YES      |
 * | worktree-waste  | reclaimable disk; the reaper owns it       | no—waits |
 * | machine-health  | coord re-probes; heals on the next tick    | no—waits |
 * | gate-pending    | coord still owes this gate a tick          | no—waits |
 * | session-health  | a heartbeat-stale session; coord re-derives| no—waits |
 * | serving-drift   | the next deploy reconciles it              | no—waits |
 * | backfill-gap    | the backfill catches up on its own         | no—waits |
 * | resolved        | already cleared                            | no       |
 * | unknown         | see below — severity decides, never "none" | varies   |
 *
 * `unknown` carries `"waiting"` as its FLOOR, not its answer: an unclassified
 * row is a statement of ignorance, and rendering ignorance as calm is the
 * `silent-empty-is-unknown` mistake. {@link deriveAlertStatus} escalates an
 * unknown *critical* row to `"author"` via {@link attentionFromSeverity}; the
 * floor applies when severity is missing or unrecognised.
 *
 * The values above are the kind's own FLOOR for every kind, not just
 * `unknown`: {@link deriveAlertStatus} raises a row whose coord `severity`
 * says louder, and never lowers one. So the `no—waits` rows here describe a
 * `warning`-severity machine/worktree alert; the same kind arriving `critical`
 * renders red. See that function's doc for why escalation is one-directional.
 */
export const ATTENTION_BY_KIND: Record<AlertKind, Attention> = {
  "stale-tree": "author",
  "stale-wip": "author",
  "git-invariant": "author",
  "disk-danger": "author",
  "red-main": "author",
  "auth-config": "author",
  "merge-stuck": "author",
  replication: "author",
  "land-integrity": "author",
  "gate-stuck": "author",
  "config-drift": "author",
  "worktree-waste": "waiting",
  "machine-health": "waiting",
  "gate-pending": "waiting",
  "session-health": "waiting",
  "serving-drift": "waiting",
  "backfill-gap": "waiting",
  resolved: "none",
  unknown: "waiting",
};

/** Plain-language status label per kind. Never a raw coord enum value. */
const LABEL_BY_KIND: Record<AlertKind, string> = {
  "stale-tree": "Checkout is stale",
  "stale-wip": "Uncommitted work going stale",
  "git-invariant": "Git bookkeeping contradicted",
  "disk-danger": "Disk nearly full",
  "red-main": "Main is red",
  "auth-config": "Auth config contradiction",
  "merge-stuck": "Merge is stuck",
  replication: "Git replication failing",
  "land-integrity": "Land record disputed",
  "gate-stuck": "Gate can never clear",
  "config-drift": "Setting armed but not in force",
  "worktree-waste": "Worktree wasting disk",
  "machine-health": "Machine unhealthy",
  "gate-pending": "Gate waiting on coord",
  "session-health": "Session stalled",
  "serving-drift": "Serving drifted from source",
  "backfill-gap": "Derived data behind",
  resolved: "Resolved",
  unknown: "Needs a look",
};

/**
 * "What to do" per kind — the second line of the expandable detail the
 * conventions require (why / what to do / links). Deliberately an instruction,
 * not a restatement of the status.
 */
const GUIDANCE_BY_KIND: Record<AlertKind, string> = {
  "stale-tree":
    "Pull the checkout onto its default branch (or commit/stash what is in it). " +
    "Agents vetting off a behind checkout cite dead code and miss shipped fixes.",
  "stale-wip":
    "Land, stash or delete the uncommitted work. A shared checkout's unstaged " +
    "changes are silently reverted the next time a peer runs a git op.",
  "git-invariant":
    "Reconcile the ref with coord's branch bookkeeping — a contradicted " +
    "invariant means a reaper or a guard is acting on a wrong premise.",
  "disk-danger":
    "Reclaim space on the named volume before a build fills it. Stale cargo " +
    "target dirs and abandoned worktrees are the usual holders.",
  "red-main":
    "Fix main, or spawn a fix session from the banner. Coord refuses to land " +
    "ANY PR onto a red main, so every green PR in the repo is frozen.",
  "auth-config":
    "Reconcile the identity configuration. Auth contradictions fail closed, " +
    "so the symptom is usually an unrelated surface going empty.",
  "merge-stuck":
    "Open the PR and clear what the train is blocked on. Coord will not " +
    "advance this candidate on its own.",
  replication:
    "Unblock the mirror or the standby. Coord refuses critical git writes it cannot " +
    "replicate (strict RPO-0), so this stops lands fleet-wide, not just this ref.",
  "land-integrity":
    "Reconcile coord's land record with GitHub before trusting any merge " +
    "verdict on this repo. Coord believing a PR landed when it did not is how " +
    "work silently disappears.",
  "gate-stuck":
    "Fix what the gate is waiting on and re-attest it, or withdraw the gate. " +
    "A terminal verdict never clears itself, so whatever is behind it waits " +
    "forever.",
  "config-drift":
    "Satisfy the precondition or unset the flag. A setting that reads as ON " +
    "while its behaviour does NOT run is worse than one that is off — every " +
    "reader downstream believes it is in force.",
  "worktree-waste":
    "Let the worktree reaper reclaim it, or junction the target directory. " +
    "No action is urgent — this is disk, not correctness.",
  "machine-health":
    "No action needed yet: coord re-probes on its own tick. Escalate only if " +
    "the row survives several polls.",
  "gate-pending":
    "No action needed: coord still owes this gate a tick. Look only if the " +
    "same gate is still here across several polls.",
  "session-health":
    "Coord re-derives session liveness every tick, so a stall CANDIDATE is not " +
    "yet a stall. Chase it only if the session is one you are waiting on.",
  "serving-drift":
    "The next deploy reconciles what is served with what should be. Escalate " +
    "only if the drift survives a deploy.",
  "backfill-gap":
    "The backfill catches up on its own tick. Until it does, anything reading " +
    "the derived data sees less than the source holds.",
  resolved: "Nothing to do — coord cleared this row.",
  unknown:
    "This build does not recognise the alert kind. Expand for coord's own " +
    "summary and payload, and add the kind to alertStatus.ts if it is real.",
};

/**
 * Coord's raw `kind` values → the derived vocabulary. EXACT matches only;
 * families are handled by the prefix rules in {@link classifyAlertKind}.
 *
 * Anchored on a live production sample taken 2026-08-14 (~1643 unresolved
 * rows) plus the producers in `qontinui-coord/crates/coord/src`.
 *
 * ## Re-anchored 2026-08-24 — the table had already rotted
 *
 * Measured against production the day qontinui-web#986 landed: **13,830
 * unresolved rows across 43 distinct kinds** (8.4× the 1,643 this table was
 * written against nine days earlier). Under the 2026-08-15 vocabulary, **18 of
 * those 43 kinds — 9,520 rows, 68.8% of the live corpus — classified
 * `unknown`**, so the surface whose whole premise is "one plain-language status
 * a reviewer can scan without expanding" answered "Needs a look" for two rows
 * in three. The four heaviest were `expectation_stall_candidate` (4,722),
 * `gate_continuation_pending` (1,937), `coord_lost_land` (1,134) and
 * `land_verification_stalled` (830) — none of them exotic, all of them whole
 * families with no entry here.
 *
 * That is the same rot the page's `KINDS` filter list was cured of by having
 * coord serve the vocabulary. This table is the SECOND hardcoded vocabulary in
 * the same feature and nothing serves it: coord's canonical registry is
 * `crates/coord/src/alert_kind.rs` (`ALL_ALERT_KINDS`, 126 wire strings) and it
 * is **not exposed over HTTP**, so a derived table is still the only option.
 * What changed is the weighting — PREFIX families over exact aliases — and
 * `alertStatus.test.ts` now pins the measured 2026-08-24 vocabulary, so the
 * next rot fails a test instead of a reviewer.
 *
 * Exact aliases below are only for kinds whose family cannot be read off their
 * prefix (`git_no_sync_target` is replication, not a ref invariant;
 * `gate_unclearable_terminal` needs a human where the rest of `gate_*` does
 * not). Everything a prefix gets right is left to the prefix.
 */
const KIND_ALIASES: Readonly<Record<string, AlertKind>> = {
  stale_primary_tree: "stale-tree",
  repo_pull_hold: "stale-tree",
  stale_wip: "stale-wip",
  orphaned_wip: "stale-wip",
  worktree_unjunctioned: "worktree-waste",
  worktree_repair_husks: "worktree-waste",
  worktree_disk_danger: "disk-danger",
  red_main: "red-main",
  auth_client_aud_active_negation: "auth-config",
  auth_group_mapping_tenant_missing: "auth-config",
  machine_degraded: "machine-health",
  machine_partitioned: "machine-health",
  fleet_partitioned: "machine-health",
  // The one `gate_*` a human must act on: coord has already decided this gate
  // can never clear, so nothing behind it moves until someone re-attests or
  // withdraws it. The rest of the family is coord's own outstanding work.
  gate_unclearable_terminal: "gate-stuck",
  // Replication, not ref bookkeeping. All three block critical git writes
  // under strict RPO-0, which is a fleet-wide land stop rather than one bad
  // ref — so they must not fall into `git-invariant` beside `git_inv-*`.
  git_no_sync_target: "replication",
  git_conflict_ref_missing: "replication",
  merge_land_replication_failed: "replication",
  // `coord_*` splits, so it gets no prefix rule: these three are the land
  // record disagreeing with GitHub. Coord's other `coord_*` kinds (GitHub
  // ratelimit, leader-election flap) are service health and are deliberately
  // NOT aliased — guessing a family for a kind this fleet has never served is
  // how the table rots in the other direction.
  coord_lost_land: "land-integrity",
  coord_land_divergence: "land-integrity",
  coord_bare_stale_seed: "land-integrity",
  // Members whose prefix names the producer rather than the family.
  serving_lag: "serving-drift",
  "served-bundle-host": "serving-drift",
  branch_protection_required_contexts: "config-drift",
};

/**
 * Raw-kind prefixes handled as a family (coord adds members freely).
 *
 * **Checked in order, and only after {@link KIND_ALIASES} misses**, so an alias
 * always wins over the family its prefix would otherwise put it in.
 *
 * Widened 2026-08-24 (see {@link KIND_ALIASES} for the measurement): the
 * 2026-08-15 table matched `pr_merge` and `git_inv`, which left
 * `pr_stuck_unattributable`, `pr_reconciler_drift`, `git_no_sync_target` and
 * `git_conflict_ref_missing` unclassified while their own siblings were
 * covered. Each prefix below is now as short as the family stays true at,
 * because the two failure modes are not symmetric: a too-NARROW prefix renders
 * a whole live kind as "Needs a look" with no attention floor, while a
 * too-WIDE one gives a future sibling a nearby label with coord's own summary
 * underneath it. The second is recoverable by reading the row; the first is
 * what this edit exists to undo.
 */
const KIND_PREFIXES: ReadonlyArray<readonly [string, AlertKind]> = [
  // `pr_merge_stuck`, `pr_merge_land_conflict_wedged`, `pr_merge_green_unlanded`,
  // `pr_merge_train_stalled`, `pr_merge_escalate_blocked`, … — coord grows this
  // family every few weeks, so it is matched by prefix, never enumerated. The
  // whole `pr_` namespace is the merge train: its non-`pr_merge_` members
  // (`pr_stuck_unattributable`, `pr_reconciler_drift`) are the train failing to
  // move or to account for a PR, which is what "Merge is stuck" already says.
  ["pr_", "merge-stuck"],
  ["merge_", "merge-stuck"],
  // Gates coord still owes a tick. The one terminal member is aliased above,
  // so what reaches here is the amber remainder.
  ["gate_", "gate-pending"],
  ["land_", "land-integrity"],
  ["mirror_", "replication"],
  // `git_inv-1` / `git_inv-2` (`format!("git_{}", invariant)` in git_observer),
  // plus any future `git_*` invariant. The two replication members are aliased
  // above and never reach this rule.
  ["git_", "git-invariant"],
  ["worktree_", "worktree-waste"],
  ["auth_", "auth-config"],
  ["machine_", "machine-health"],
  // `expectation_stall_candidate` is the single largest kind in the live
  // corpus (4,722 of 13,830 on 2026-08-24) and it is about a SESSION, not a
  // machine — coord re-derives liveness every tick, so the family floors at
  // `waiting`: 4,722 rows of red would drown the tier that means "act now".
  ["expectation_", "session-health"],
  // `session_message_delivery_blocked` is the family's odd member — a blocking
  // message that cannot reach a dead target is arguably someone's problem now.
  // It is held at the family's `waiting` FLOOR anyway, because coord types it
  // `warning` and the floor is a floor: if coord ever raises it to `critical`,
  // `deriveAlertStatus` escalates the row without an edit here. Overriding
  // coord's own severity from a lookup table is the inversion this module
  // refuses everywhere else.
  ["session_", "session-health"],
  ["config_", "config-drift"],
  ["route_", "serving-drift"],
  ["memory_", "backfill-gap"],
];

const UUID_SRC =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Matches a canonical UUID anywhere in a string. */
const UUID_RE = new RegExp(UUID_SRC, "gi");

/**
 * A UUID plus ONE path separator it strands when removed.
 *
 * Coord writes `"{device_id}/{repo}"`, so a bare removal leaves a leading
 * `/qontinui/qontinui-web`. Consuming one adjacent slash (leading first, then
 * trailing) fixes that WITHOUT the unconditional slash-tidying that used to
 * follow — which matched the first `/` of `://` and turned every
 * `https://github.com/…` in a summary into `https: github.com/…`.
 */
const UUID_WITH_SEPARATOR = new RegExp(
  `/${UUID_SRC}|${UUID_SRC}/|${UUID_SRC}`,
  "gi"
);

/**
 * The `slice(0, 8)` form the deleted `AlertCard` rendered — "a truncated UUID
 * is still a UUID", per this module's own header. Only the ellipsised spelling
 * is matched: 8 bare hex characters are indistinguishable from a git short SHA
 * (`head_sha` is in almost every alert `detail` and is legitimately shown), so
 * a rule on bare 8-hex would delete real, useful identifiers. Nothing in this
 * codebase produces the ellipsised form any more; the rule is here so a
 * payload that arrives pre-truncated from coord cannot smuggle one in.
 */
const TRUNCATED_UUID_RE = /\b[0-9a-f]{8}(?:…|\.\.\.)/gi;

/**
 * Remove every UUID from an operator-facing string.
 *
 * Not paranoia: coord's own alert summaries interpolate the device UUID
 * (`stale_wip_watcher.rs` — `"primary tree {device_id}/{repo} has been dirty
 * for {n}h"`), so rendering `summary` verbatim would breach the plan's hard
 * rule through the back door.
 *
 * A string with NO UUID is returned BYTE-FOR-BYTE. The tidy-up rules exist
 * only to clean the wreckage a removed UUID leaves; running them
 * unconditionally corrupted strings this function has no business touching —
 * a `red_main` or `pr_merge_*` summary carrying a GitHub run URL is the
 * realistic case.
 */
export function stripUuids(text: string): string {
  const stripped = text
    .replace(UUID_WITH_SEPARATOR, "")
    .replace(TRUNCATED_UUID_RE, "");
  if (stripped === text) return text;
  return stripped
    // Brackets whose only content was the UUID: `(…)`, `{…}`, `[…]`.
    .replace(/\(\s*\)/g, "")
    .replace(/\{\s*\}/g, "")
    .replace(/\[\s*\]/g, "")
    // A slash run left completely stranded between spaces. Deliberately NOT a
    // rule about slashes generally — see UUID_WITH_SEPARATOR.
    .replace(/(^|\s)\/+(?=\s|$)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** True when a string still contains a UUID — the guard the tests assert on. */
export function containsUuid(text: string): boolean {
  UUID_RE.lastIndex = 0;
  return UUID_RE.test(text);
}

/** Attention for a row whose kind this build does not recognise. */
export function attentionFromSeverity(severity?: string): Attention {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return "author";
    case "warning":
      return "waiting";
    case "info":
      return "none";
    default:
      // Severity absent or unrecognised: fall back to the table's floor rather
      // than to calm. Absence is UNKNOWN, not "nothing is wrong".
      return ATTENTION_BY_KIND.unknown;
  }
}

// The `ATTENTION_RANK` table and its `escalate` helper used to be declared
// here. They are now `console/attention`'s `ATTENTION_RANK` and
// `escalateAttention` — character-for-character the same rank table and the
// same comparison, generalised out of this file and `prPipeline` by the console
// extraction, then left un-adopted here. Same semantics, one definition.

/**
 * Map coord's raw `kind` onto the derived vocabulary.
 *
 * A resolved row classifies as `resolved` regardless of what produced it: its
 * original kind's red would otherwise survive the resolution and paint a
 * cleared row as an emergency.
 */
export function classifyAlertKind(row: CoordAlertRow): AlertKind {
  if (row.resolved_at) return "resolved";
  const raw = (row.kind ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  const exact = KIND_ALIASES[raw];
  if (exact) return exact;
  for (const [prefix, kind] of KIND_PREFIXES) {
    if (raw.startsWith(prefix)) return kind;
  }
  return "unknown";
}

/** A `detail` value read as a display string, or null when it is not one. */
function str(detail: Record<string, unknown> | undefined, key: string): string | null {
  const v = detail?.[key];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

/** A `detail` value read as a finite number, or null. */
function num(detail: Record<string, unknown> | undefined, key: string): number | null {
  const v = detail?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** A `detail` value read as a boolean, or null when absent/other-typed. */
function bool(detail: Record<string, unknown> | undefined, key: string): boolean | null {
  const v = detail?.[key];
  return typeof v === "boolean" ? v : null;
}

/** A `detail` value read as a list of display strings (possibly empty). */
function strList(
  detail: Record<string, unknown> | undefined,
  key: string
): string[] {
  const v = detail?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/** Coord's own summary. Sanitised centrally by `deriveAlertStatus`. */
function rawSummary(row: CoordAlertRow): string {
  return row.summary ?? "";
}

/**
 * The plain-language "why" for a row: built from the human-readable fields
 * coord already puts in `detail`, falling back to coord's summary and finally
 * to "".
 *
 * ⚠️ Returns a string that has NOT been sanitised. It interpolates `detail`
 * values (`default_branch`, `workflows`, …) and coord's raw summary, both of
 * which can carry a UUID. `deriveAlertStatus` is the single place that strips,
 * so a new branch here is covered BY CONSTRUCTION rather than by remembering
 * to call `stripUuids` — which is exactly the discipline that failed once.
 */
function reasonFor(kind: AlertKind, row: CoordAlertRow): string {
  const d = row.detail;
  switch (kind) {
    case "stale-tree": {
      const parts: string[] = [];
      const behind = num(d, "behind_default_count") ?? num(d, "behind_count");
      const base = str(d, "default_branch");
      if (behind !== null && behind > 0) {
        parts.push(
          `${behind} commit${behind === 1 ? "" : "s"} behind${base ? ` ${base}` : " its default branch"}`
        );
      }
      if (bool(d, "tree_clean") === false) parts.push("uncommitted changes");
      const untracked = num(d, "untracked_count");
      if (untracked !== null && untracked > 0) {
        parts.push(`${untracked} untracked file${untracked === 1 ? "" : "s"}`);
      }
      if (bool(d, "head_detached") === true) parts.push("HEAD detached");
      return parts.length > 0 ? parts.join(", ") : rawSummary(row);
    }
    case "stale-wip": {
      const parts: string[] = [];
      const dirty = num(d, "dirty_file_count") ?? num(d, "orphaned_file_count");
      if (dirty !== null && dirty > 0) {
        parts.push(`${dirty} uncommitted file${dirty === 1 ? "" : "s"}`);
      }
      const age = num(d, "age_hours");
      if (age !== null && age > 0) parts.push(`untouched for ${Math.round(age)}h`);
      return parts.length > 0 ? parts.join(", ") : rawSummary(row);
    }
    case "red-main": {
      const parts: string[] = [];
      const workflows = strList(d, "workflows");
      if (workflows.length > 0) parts.push(`failing: ${workflows.join(", ")}`);
      const blocked = num(d, "blocked_pr_count");
      if (blocked !== null && blocked > 0) {
        parts.push(`${blocked} PR${blocked === 1 ? "" : "s"} frozen`);
      }
      return parts.length > 0 ? parts.join(" · ") : rawSummary(row);
    }
    default:
      return rawSummary(row);
  }
}

/** The derived, renderable status of one alert row. */
export interface AlertStatus {
  kind: AlertKind;
  /** Plain-language status. Never a raw coord enum value. */
  label: string;
  /** Brief plain-language why / next signal. May be "". */
  reason: string;
  attention: Attention;
}

/**
 * Map a `coord.alerts` row to its plain-language status.
 *
 * Total: every row produces a status, including one whose `kind` this build
 * has never seen (`unknown`, with severity-derived attention) and one with no
 * `kind` at all.
 *
 * **Severity ESCALATES a known kind; it never de-escalates one.** The kind
 * table encodes the kind's own semantics — `machine-health` waits because
 * coord re-probes it on its own tick, and that stays true of a *warning*
 * machine row. But coord marking a row `critical` is evidence the table cannot
 * see, so it is allowed to raise the row (a `critical` `fleet_partitioned`
 * reads red, not amber) and never to lower it (an `info`-severity
 * `red_main` is still a frozen repo). `resolved` is exempt in both directions:
 * a cleared row is calm whatever severity it carried while it was live.
 *
 * **`reason` is sanitised HERE, once.** `reasonFor` interpolates `detail`
 * values and coord's raw summary, both of which can carry a UUID, and the
 * result is operator-visible in three places (the row line, its `title`, and
 * the badge `title`). Stripping at the single exit covers every branch by
 * construction instead of by per-branch discipline.
 */
export function deriveAlertStatus(row: CoordAlertRow): AlertStatus {
  const kind = classifyAlertKind(row);
  const bySeverity = attentionFromSeverity(row.severity);
  const attention =
    kind === "resolved"
      ? "none"
      : kind === "unknown"
        ? bySeverity
        : escalateAttention(ATTENTION_BY_KIND[kind], bySeverity);
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason: stripUuids(reasonFor(kind, row)),
    attention,
  };
}

/** The "what to do" line for a row, for the expanded detail. */
export function alertGuidance(kind: AlertKind): string {
  return GUIDANCE_BY_KIND[kind];
}

// ----------------------------------------------------------------------------
// Subject — "what is this alert ABOUT", in terms a human recognises.
//
// The plan's hard rule: identify by repo, branch, PR number, worktree name,
// hostname — never by `alert_key` and never by a UUID. Everything below is
// derived from `detail` first, and only then from the NON-UUID segments of the
// alert key (a key like `stale-tree:<uuid>:qontinui-runner-wt-mtobs` carries
// the worktree name a human actually recognises; a key like
// `worktree:disk_danger::D:` carries the drive).
// ----------------------------------------------------------------------------

/** Detail keys that name a thing, in the order a human would read them. */
const SUBJECT_KEYS = [
  "repo",
  "repository",
  "hostname",
  "host",
  "worktree",
  "worktree_name",
  "path",
  "volume",
  "drive",
  "mount",
  "ref",
  "branch_ref",
] as const;

/** `stale-tree` and `stale_tree` are the same word to a reader. */
function normalizeSegment(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The non-UUID, non-namespace tail of an alert key — a worktree name, a drive
 * letter, a repo slug. Returns "" when every segment is a UUID or a machine
 * namespace, which is the case this function exists to make safe.
 *
 * `rawKind`, when given, also drops any segment the kind already restates
 * (`worktree:disk_danger::D:` under kind `worktree_disk_danger` is about the
 * `D:` volume — "disk danger" is what the status LABEL says). Short segments
 * are never dropped this way: a drive letter is a substring of almost
 * everything.
 */
export function subjectFromAlertKey(alertKey: string, rawKind?: string): string {
  const kindWord = normalizeSegment(rawKind ?? "");
  const segments = alertKey
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !containsUuid(s));
  // The first segment is the watcher's namespace (`stale-tree`, `worktree`,
  // `red_main`) — machine vocabulary the status label already says better.
  const tail = segments.slice(1).filter((s) => {
    const w = normalizeSegment(s);
    return !(w.length >= 4 && kindWord.includes(w));
  });
  return tail.length > 0 ? tail.join(" · ") : "";
}

/**
 * A scan-friendly identity for one alert row. Guaranteed UUID-free.
 *
 * "" when the payload genuinely carries nothing human-readable — the caller
 * renders the status alone rather than falling back to the machine key, which
 * is the whole point of the rule.
 */
export function alertSubject(row: CoordAlertRow): string {
  const d = row.detail;
  const parts: string[] = [];

  for (const key of SUBJECT_KEYS) {
    const v = str(d, key);
    if (v && !containsUuid(v)) {
      parts.push(v);
      break;
    }
  }

  const pr = num(d, "pr_number");
  if (pr !== null) {
    parts.push(`#${pr}`);
  } else {
    const branch = str(d, "branch");
    if (branch && !containsUuid(branch)) parts.push(branch);
  }

  if (parts.length > 0) return parts.join(" · ");
  return subjectFromAlertKey(row.alert_key ?? "", row.kind);
}

/**
 * `detail` entries safe to show in the EXPANDED panel, as ordered pairs.
 *
 * Drops `device_id` and any other UUID-valued entry: a device UUID is only
 * admissible where it is genuinely actionable (something to paste into a
 * tool), and the row renderer surfaces that one deliberately and separately.
 * Object/array values are JSON-encoded so a nested payload is still readable
 * without a second click.
 */
export function detailEntries(
  row: CoordAlertRow
): Array<{ key: string; value: string }> {
  const d = row.detail;
  if (!d) return [];
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(d)) {
    if (key === "device_id" || raw === null || raw === undefined) continue;
    const value =
      typeof raw === "string" ? raw : JSON.stringify(raw) ?? String(raw);
    if (containsUuid(value)) continue;
    out.push({ key, value });
  }
  return out;
}
