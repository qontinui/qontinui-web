/**
 * spawnPathCatalog — the words the spawn-path matrix puts on each path, and
 * the few paths nothing serves.
 *
 * Two lists, with different standing:
 *
 * - {@link SERVED_PATH_WORDS} is PRESENTATION for rows coord serves. A coord
 *   path's row exists because coord's effective registry serves it (or the
 *   contract names it — `spawnPathContract.ts`); this table only gives it a
 *   name in words, the one sentence saying what it starts, and which other
 *   coord settings also govern it. A served kind this table does not know
 *   still gets its row, named by its token (`servedPathWords`), so a new kind
 *   coord serves is never missing from the matrix — only unlabelled.
 * - {@link UNSERVED_PATHS} is the hand-kept list, and it exists ONLY for what
 *   nothing serves: the post-merge follow-up (it rides the gate-continuation
 *   kind, so no registry row names it) and the paths a runner starts on its
 *   own, which coord cannot see. `spawnPathContract.test.ts` pins this list
 *   against the served kinds: no entry may name a served kind or class.
 *
 * Every label and summary here can be shown to an outsider: no wire token,
 * setting key or variable name. Those live in the `operator` arms (`where`,
 * `offEffect`), which render in operator mode only; each has a `presented`
 * twin in plain words.
 */

import { isSpawnClass } from "./spawnPathContract";

/** Which next-step decision domain also gates a path (coord's next-step settings). */
export type NextStepDomainKey =
  | "next_step"
  | "pr_fix"
  | "red_main_fix"
  | "admission_stall_fix";

/**
 * Who reads a registry row's off switch.
 *
 * - `coord` — coord's spawn seam, which folds the registry's TENANT DEFAULTS
 *   only: a member's own preference does not bind it
 *   (`spawn_authorization.rs`, "Prefs do NOT bind enforcement").
 * - `runner` — each runner, which reads the registry for the member it is
 *   signed in as (the tenant default, or that member's own preference).
 * - `both` — the standing class switch: coord's seam folds it with every
 *   standing kind, and each runner's funnel reads it too.
 */
export type EnforcedBy = "coord" | "runner" | "both";

/** What switching a runner-read row off does, for each audience. */
export interface OffEffect {
  readonly operator: string;
  readonly presented: string;
}

/** A tenant merge-settings knob that also gates a path (besides its dial). */
export type TenantKnobKey = "auto_fix_red_main" | "auto_fix_admission_stall";

export interface ServedPathWords {
  /** The path's name in the console. */
  readonly label: string;
  /** One sentence: what this path starts. */
  readonly summary: string;
  /** The next-step domain whose autonomy level and fleet flag also gate it. */
  readonly nextStepDomain?: NextStepDomainKey;
  /** The tenant merge-settings dial that also gates it. */
  readonly tenantDial?: "auto_fix_pr";
  /** The tenant merge-settings knob that also gates it. */
  readonly tenantKnob?: TenantKnobKey;
  /**
   * The spawn ledger `origin` that names this path and NO other. Absent when
   * the ledger records the path under an origin it shares with others — then
   * the ledger cannot say when this path last spawned.
   */
  readonly ledgerOrigin?: string;
  /** Who reads the row's off switch. */
  readonly enforcedBy: EnforcedBy;
  /** What off does on a runner-read row (a runner degrades rather than refuses). */
  readonly offEffect?: OffEffect;
  /** A class switch: one row governing every path of its class. */
  readonly isClass?: boolean;
  /** Sessions a PERSON asks for (the console's launcher), not started on its own. */
  readonly startedByPerson?: boolean;
}

/** The words for each served name the console knows, keyed by registry name. */
export const SERVED_PATH_WORDS: Readonly<Record<string, ServedPathWords>> = {
  next_step_dispatch: {
    label: "Next step",
    summary:
      "Continues a session that went quiet, from the next step worked out for it.",
    nextStepDomain: "next_step",
    enforcedBy: "coord",
  },
  pr_fix_dispatch: {
    label: "PR fixer",
    summary:
      "Starts a fixer for a pull request that was diagnosed as needing rework.",
    nextStepDomain: "pr_fix",
    tenantDial: "auto_fix_pr",
    enforcedBy: "coord",
  },
  red_main_fix_dispatch: {
    label: "Red-main fixer",
    summary: "Starts a fixer for a repository whose main branch is failing.",
    nextStepDomain: "red_main_fix",
    tenantKnob: "auto_fix_red_main",
    enforcedBy: "coord",
  },
  admission_stall_fix_dispatch: {
    label: "Stalled-train responder",
    summary:
      "Starts one bounded steward pass when the merge queue has work and admits none of it.",
    nextStepDomain: "admission_stall_fix",
    tenantKnob: "auto_fix_admission_stall",
    enforcedBy: "coord",
  },
  merge_shepherd: {
    label: "Merge shepherd",
    summary: "Escalates a pull request the merge queue cannot land.",
    enforcedBy: "coord",
  },
  gate_continuation: {
    label: "Gate continuation",
    summary:
      "Resumes a session when the condition it was waiting on clears, including the follow-up after a merge.",
    ledgerOrigin: "gate_continuation",
    enforcedBy: "coord",
  },
  unit_continuation: {
    label: "Unit dispatch",
    summary: "Starts a fresh session for one unit of planned work.",
    ledgerOrigin: "unit_continuation",
    enforcedBy: "coord",
  },
  condition_autodispatch: {
    label: "Condition autodispatch",
    summary: "Runs a condition group's audit on its schedule or trigger.",
    enforcedBy: "coord",
  },
  onboarding_audit: {
    label: "Onboarding audit",
    summary:
      "Audits a newly connected repository to propose its merge settings.",
    enforcedBy: "coord",
  },
  operator_page_remediation: {
    label: "Paged-condition responder",
    summary:
      "Sends the steward that owns a paged condition to make one pass before a person is paged.",
    enforcedBy: "coord",
  },
  operator_spawn: {
    label: "Console launches",
    summary: "Sessions a person starts from the console's launch page.",
    enforcedBy: "coord",
    startedByPerson: true,
  },
  standing_continuation: {
    label: "Every standing spawn",
    summary:
      "The class switch over every path that starts a session on its own: off stops all of them at once.",
    enforcedBy: "both",
    isClass: true,
  },
  parallel_fanout: {
    label: "Parallel fan-out",
    summary:
      "The class switch for sessions that split work across parallel helpers: off makes them work one at a time.",
    enforcedBy: "runner",
    // The contract: "Disabling it degrades ALL parallel fan-out to inline".
    offEffect: {
      operator:
        "Each runner reads it before a session fans work out to parallel helpers. While it is off the session does that work itself, one step at a time (a tenant default off degrades; a member's own preference can choose to refuse instead).",
      presented:
        "Each machine reads it: while it is off, sessions do this work one step at a time instead.",
    },
    isClass: true,
  },
  in_session_subagent: {
    label: "In-session helpers",
    summary:
      "The class switch for helpers a session starts inside itself; nothing seeds it, so it exists only when someone created it.",
    enforcedBy: "runner",
    offEffect: {
      operator:
        "Each runner reads it before a session starts a helper inside itself. While it is off the session does the work itself (a tenant default off degrades; a member's own preference can choose to refuse instead).",
      presented:
        "Each machine reads it: while it is off, sessions do the work themselves instead of starting helpers.",
    },
    isClass: true,
  },
};

/** A served name in words: the catalog's, or the name itself with spaces. */
export function servedPathWords(
  name: string,
  spawnPath: string | null
): ServedPathWords {
  const known = SERVED_PATH_WORDS[name];
  if (known) return known;
  const words = name.replace(/[_-]+/g, " ").trim() || "unnamed path";
  return {
    label: words.charAt(0).toUpperCase() + words.slice(1),
    summary:
      "A path the coordination service serves that this console has no description for yet.",
    // An unknown standing kind is coord-initiated, and coord enforces its row.
    enforcedBy: spawnPath === "standing_continuation" ? "coord" : "runner",
    isClass: isSpawnClass(name),
  };
}

/** Where a hand-kept path's switch lives, for each audience. */
export interface SwitchWhere {
  /** Operator mode: exact, naming the setting. */
  readonly operator: string;
  /** Presentation mode: plain words, naming no setting key. */
  readonly presented: string;
}

/** A path nothing serves as a registry row. */
export interface UnservedPath {
  readonly key:
    | "post_merge_followup"
    | "runner_stewards"
    | "runner_scheduler"
    | "account_migration";
  readonly label: string;
  readonly summary: string;
  /** Who starts it. */
  readonly startedBy: "coord" | "runner";
  /** The ledger origin that names it and no other path, when there is one. */
  readonly ledgerOrigin?: string;
  /**
   * The origin names only SOME of this path's starts, and why: a start under
   * it is a real start of the path, but its absence proves nothing.
   */
  readonly ledgerPartial?: string;
  /** Why the ledger cannot say when it last spawned, when it cannot. */
  readonly ledgerBlind?: string;
  /** Where its switch is set (runner-local paths only: they are read-only here). */
  readonly where?: SwitchWhere;
}

/**
 * The hand-kept rows. Runner-local paths are switched on each machine and
 * coord never sees them, so the console reads none of their state: each says
 * where it is set, and its state is UNKNOWN here by construction.
 */
export const UNSERVED_PATHS: readonly UnservedPath[] = [
  {
    key: "post_merge_followup",
    label: "Post-merge follow-up",
    summary:
      "Starts a follow-up session for a pull request after it merges, unless the repository's scope skips it.",
    startedBy: "coord",
    ledgerBlind:
      "the ledger records a post-merge follow-up as a gate continuation and carries no field that tells the two apart",
  },
  {
    key: "runner_stewards",
    label: "Runner stewards",
    summary:
      "Long-running steward sessions a machine keeps open for the merge queue, operations and cleanup.",
    startedBy: "runner",
    ledgerOrigin: "steward",
    // The runner stamps `steward` on a steward started over HTTP or by the
    // drain restart; its own window's start button stamps `operator_terminal`
    // (`steward.rs` `steward_start`, `coord_drain_state.rs` `SpawnOrigin`).
    ledgerPartial:
      "a steward started from a runner's own window is recorded as an operator terminal, so the ledger names only some steward starts",
    where: {
      operator:
        "On each runner: its steward controls start and stop one session per steward kind, and set that steward's own enable variable when they launch it.",
      presented: "Switched on each machine, by that machine's own runner.",
    },
  },
  {
    key: "runner_scheduler",
    label: "Runner scheduler",
    summary: "Sessions a machine starts on a schedule it keeps itself.",
    startedBy: "runner",
    // `scheduler` is a value the ledger's origin CHECK permits, and that is all
    // it is: the writers plan
    // 2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration
    // Phase 2 scopes are coord's own spawn sites, and a runner's local starts
    // are explicitly not converted into requests. So "no request in the last 7
    // days" would stand on a path nothing records.
    ledgerBlind:
      "a machine's scheduled starts are not written to the spawn ledger, which records what coord was asked to start",
    where: {
      operator:
        "On each runner: every scheduled task is switched on or off in that runner's scheduler.",
      presented: "Switched on each machine, by that machine's own runner.",
    },
  },
  {
    key: "account_migration",
    label: "Account migration",
    summary:
      "Moves a session whose account ran out of usage onto another account, so the work continues.",
    startedBy: "runner",
    ledgerBlind:
      "a migration moves a session that is already running, and the ledger records only requests to start one",
    where: {
      operator:
        "On each runner: the setting claude_cli.auto_migrate_on_token_exhaustion, which does nothing on a machine with fewer than two accounts.",
      presented: "Switched on each machine, by that machine's own runner.",
    },
  },
];
