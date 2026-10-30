/**
 * Decision-domain policy rows (`next_step` family), client side.
 *
 * A decision policy is a **v2** `coord.policy_rules` row: `decision_domain`
 * + `mode` + `payload`, with `kind = NULL`. It is the row coord's
 * `policies::decide` resolver consults when a session asks "what should happen
 * next?" for one of the domains below. Until this module existed the console
 * could author only the two **v1** `RuleKind`s
 * (`automation-rules/types.ts` — `terminal_auto_response`,
 * `question_auto_answer`), so a `pr_fix` row could be written only by a
 * logged-in tenant admin issuing a raw HTTP request from a browser session.
 * Plan `2026-09-06-decision-policy-rows-are-operator-only-to-create`, D3.
 *
 * The stack underneath is NOT new: `/admin/coord/gate-clearance` already
 * authors v2 rows through `_shared/useCoordPolicies` + the
 * `coordPolicies` client. This is that surface for a different domain
 * family, and it inherits gate-clearance's two hard coord facts —
 * see [`DecisionPolicyUpdate`] (no `payload`, no `enabled`).
 *
 * ## The bounded domain set, and why it is bounded
 *
 * `decision_domain` is an OPEN string server-side: coord's create route takes
 * any non-empty value. Coord nonetheless has ~25 domain constants in flight,
 * and most are internal safety resolvers whose rows an operator should not
 * hand-author from a generic JSON box — `gate_clearance` has its own page with
 * an effective-authority preview, and `terminal_auto_response` is the domain
 * the runner-rules feed reads to inject text into live terminals fleet-wide.
 *
 * So this page offers a NAMED set rather than a free-text box, seeded from the
 * one set coord itself already treats as a managed family: `DOMAIN_SPECS` in
 * qontinui-coord `crates/coord/src/policies/next_step_settings.rs`, the façade
 * behind `GET/PUT /coord/next-step-settings`, whose `is_known_domain` (same
 * file) is the server-side membership test for exactly these six. (Cited by
 * symbol, not line number: line references into coord rot.)
 *
 * What makes them safe to author here is NOT that the domains are harmless —
 * the fixer arms (`pr_fix`, `red_main_fix`, `admission_stall_fix`) can
 * dispatch an agent, and coord's seeded `admission_stall_fix` system row at
 * `auto_decide` IS the autonomy conjunct for a merge-train-steward dispatch.
 * It is that a row authored on THIS page never grants an authority by itself:
 * it lands at `always_escalate` (see [`CREATE_IS_INERT`]), and graduating it
 * is a separate, deliberate step, and even a graduated row acts only while
 * coord's own autodispatch env flag for THAT domain is on (its `master_flag`,
 * e.g. `COORD_ADMISSION_STALL_FIX_AUTODISPATCH_ENABLED` — there is no single
 * platform-wide master switch) and, for the fixer domains, the tenant or repo
 * auto-fix opt-in allows it (see [`MASTER_FLAG_CAVEAT`]). A row in any other domain is not listed and not
 * creatable on this page; that is a deliberate, reviewable edit to
 * [`DECISION_POLICY_DOMAINS`], not an omission.
 *
 * ## Creating a row arms NOTHING — but it can DISARM a system default
 *
 * Coord's `CreatePolicyRequest` (`policies/routes.rs`) has no
 * `autonomy_level` field at all (its doc records why — coord#920 makes
 * graduation an explicit, auditable PATCH boundary), so every created row lands at the
 * column default `always_escalate`, which `policies/decide.rs` short-circuits
 * to `Escalate` **regardless of mode**. A created row therefore never GRANTS
 * coord room to act. See [`CREATE_IS_INERT`].
 *
 * It is NOT true that nothing else changes. `resolve_decision_detailed`
 * (`policies/decide.rs`, the `resolve_policies_by_domain` call) takes the
 * highest-precedence matched row by band — `repo > tenant > system` — and a
 * tenant row outranks the system row whatever its level (coord's own seed note
 * for `admission_stall_fix` in `policies/table.rs` `ensure_system_defaults`:
 * *"a tenant row outranks this system row"*). So for a domain where coord
 * serves a SYSTEM ROW above `always_escalate`, creating a workspace-wide row
 * TURNS THAT DEFAULT OFF for the workspace until the new row is graduated; a
 * repo-scoped row does the same for that repo only. Where the default is only
 * coord's `code_fallback` (no row), a consult already escalates, and the only
 * change is the hold marker moving from `escalated_no_policy` to
 * `escalated_by_policy`. The form warns per domain — see
 * [`createDefaultCaution`].
 *
 * Which domains have such a row is NOT recorded here. A seeded system row is
 * mutable state and may differ from its seed, so the form reads it LIVE
 * from `GET /coord/next-step-settings` — each domain's
 * `default_autonomy_level` + `default_source`
 * (`next_step_settings::display_default`), plus `resolved_from` /
 * `autonomy_level` (which band wins today, resolved with no repo) — every time
 * the dialog opens. An unread default (loading, failed, or the domain missing
 * from the response) is UNKNOWN and gets its own caution; it is never read as
 * "no system row".
 *
 * "Creating one turns the default off" is only true when nothing in the tenant
 * band already wins. When `resolved_from` is `tenant`, a workspace row already
 * overrides the default, and a new workspace-wide row takes effect only if it
 * outranks that row (lower priority number, then older). An in-place PATCH
 * that changes a row's repo scope moves what it outranks too, at the row's
 * CURRENT level — see [`scopeEditCaution`].
 *
 * That read is repo-less, so it cannot see rows scoped to a repo. The form
 * checks the page's own loaded rows for a same-domain, same-repo row
 * ([`sameScopeRows`]); when those rows are not loaded it qualifies its claim
 * rather than asserting the new row wins.
 *
 * For the system tenant's own rows, a new workspace-wide row shares the seed's
 * band (coord reports the system tenant's tenant-wide rows as `system`), so at
 * an equal priority number it loses the tie to the older seed — and because
 * the system tenant's rows ARE every tenant's system band, a row there that
 * does win changes the default for every tenant, not one workspace.
 */

import type { CoordPolicyRow } from "@/lib/api/operations/coordPolicies";

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/** One authorable decision domain, mirroring coord's `DomainSpec`. */
export interface DecisionDomainSpec {
  /** The `decision_domain` column value. */
  domain: string;
  label: string;
  description: string;
  /** The `mode` coord's own façade treats as canonical for the domain. */
  canonicalMode: DecisionPolicyMode;
  /**
   * True when `auto_decide` alone is not enough: coord's
   * `next_step_settings::effective` also requires the domain's own
   * autodispatch env flag (its `master_flag`; there is no single platform-wide
   * master switch) before the domain acts.
   */
  requiresMaster: boolean;
  /**
   * Whether this domain's consults carry a repo. `false` means coord resolves
   * every consult with `repo = None`, so a repo-scoped row is listed but can
   * never serve (coord `fixer_arm_readiness::DarkArm::consults_carry_repo`,
   * pinned by its test `repo_rows_do_not_serve_the_repo_less_admission_stall_arm`;
   * the trigger side is `next_step::NextStepTrigger::repo`, which returns
   * `None` for `AdmissionStallNeedsResponse`). The form offers no repo scope
   * for such a domain and [`buildCreateBody`] never sends one.
   */
  repoScoped: boolean;
}

/**
 * The six domains this page authors — coord's `DOMAIN_SPECS`, in coord's own
 * order. Adding a row here widens what an operator may hand-author; read the
 * module header before doing it.
 */
export const DECISION_POLICY_DOMAINS: readonly DecisionDomainSpec[] = [
  {
    domain: "next_step",
    label: "Next step after a session goes stale",
    description:
      "Coordination may pick (auto_decide) or frame (guidance_only) the next step when an interactive session goes stale or a work unit lands.",
    canonicalMode: "guidance",
    requiresMaster: true,
    repoScoped: true,
  },
  {
    domain: "pr_fix",
    label: "Automatic fixer for stuck PRs",
    description:
      "Coordination may dispatch (auto_decide) or frame (guidance_only) a fixer agent when one of your PRs is detected stuck in review or CI.",
    canonicalMode: "guidance",
    requiresMaster: true,
    repoScoped: true,
  },
  {
    domain: "red_main_fix",
    label: "Automatic fixer for code-class red main",
    description:
      "Coordination may dispatch (auto_decide) or frame (guidance_only) a fixer agent when a repo's main goes red for a code reason (not an infra-cancel) — a whole-repo condition with no owning PR-author session.",
    canonicalMode: "guidance",
    requiresMaster: true,
    repoScoped: true,
  },
  {
    domain: "admission_stall_fix",
    label: "Automatic responder for a stalled merge train",
    description:
      "Coordination may dispatch (auto_decide) or frame (guidance_only) a merge-train steward when your tenant's merge-train admission stalls — a whole-train condition with no owning PR-author session.",
    canonicalMode: "guidance",
    requiresMaster: true,
    repoScoped: false,
  },
  {
    domain: "architecture_tradeoff",
    label: "Architecture trade-offs",
    description: "How design trade-offs are decided.",
    canonicalMode: "guidance",
    requiresMaster: false,
    repoScoped: true,
  },
  {
    domain: "verification_sufficiency",
    label: "Verification sufficiency",
    description: "When evidence is enough to call work done.",
    canonicalMode: "guidance",
    requiresMaster: false,
    repoScoped: true,
  },
] as const;

/**
 * The domain a create form starts on.
 *
 * Named rather than spelled `DECISION_POLICY_DOMAINS[0].domain`: under
 * `noUncheckedIndexedAccess` an index into a readonly array is possibly
 * `undefined`, and a `!` there would be asserting something about a list that
 * is meant to be reordered and extended. `DEFAULT_DECISION_DOMAIN_IS_KNOWN` in
 * the tests pins it to the set.
 */
export const DEFAULT_DECISION_DOMAIN = "next_step";

/** Fast membership test over [`DECISION_POLICY_DOMAINS`]. */
export function isDecisionPolicyDomain(domain: string | null): boolean {
  return DECISION_POLICY_DOMAINS.some((s) => s.domain === domain);
}

export function domainSpec(domain: string | null): DecisionDomainSpec | null {
  return DECISION_POLICY_DOMAINS.find((s) => s.domain === domain) ?? null;
}

/**
 * Is this row one THIS page owns?
 *
 * Deliberately narrower than "is a v2 row": `gate_clearance` rows are v2 too
 * and belong to `/admin/coord/gate-clearance`, which renders an
 * effective-authority preview this page cannot.
 */
export function isDecisionPolicyRow(row: CoordPolicyRow): boolean {
  return isDecisionPolicyDomain(row.decision_domain);
}

// ---------------------------------------------------------------------------
// Modes + autonomy
// ---------------------------------------------------------------------------

/** The two `mode` values a v2 row may carry (coord `V2_MODES`). */
export type DecisionPolicyMode = "guidance" | "data_driven";

export const DECISION_POLICY_MODES: readonly DecisionPolicyMode[] = [
  "guidance",
  "data_driven",
] as const;

export const MODE_LABELS: Record<DecisionPolicyMode, string> = {
  guidance: "Guidance frame",
  data_driven: "Data-driven (named query)",
};

export const MODE_DESCRIPTIONS: Record<DecisionPolicyMode, string> = {
  guidance:
    "The payload carries constraints, a rubric and notes. Coord composes them into a frame the deciding agent reads.",
  data_driven:
    "As Guidance, plus a `query` object naming a server-side registered query coord runs for evidence. Coord falls back to the plain priority frame when the query is missing or unregistered.",
};

/** Coord's three-value autonomy dial (`policies/routes.rs` AUTONOMY_LEVELS). */
export type AutonomyLevel = "always_escalate" | "guidance_only" | "auto_decide";

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  "always_escalate",
  "guidance_only",
  "auto_decide",
] as const;

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  always_escalate: "Always escalate",
  guidance_only: "Guidance only",
  auto_decide: "Auto decide",
};

export const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  always_escalate:
    "Coord short-circuits every consult for this domain to Escalate, whatever the mode says. The row is inert: it changes the hold marker from escalated_no_policy to escalated_by_policy and nothing else.",
  guidance_only:
    "Coord serves this frame to the deciding agent, but will not act on it — recorded, not acted. The dispatch arms stay inert.",
  auto_decide:
    "Coord may act on this frame without asking you — for the fixer domains that means dispatching a fixer agent.",
};

/** Ordering, loosest last. Used to decide whether a change is a LOOSENING. */
export const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  always_escalate: 0,
  guidance_only: 1,
  auto_decide: 2,
};

/** True when moving `from` → `to` grants coord more room to act. */
export function isLoosening(from: AutonomyLevel, to: AutonomyLevel): boolean {
  return AUTONOMY_RANK[to] > AUTONOMY_RANK[from];
}

/** A row's `autonomy_level`, or `null` when coord served a value this build
 *  does not know — UNKNOWN, never defaulted to the safe end. */
export function parseAutonomyLevel(value: string | null): AutonomyLevel | null {
  return (AUTONOMY_LEVELS as readonly string[]).includes(value ?? "")
    ? (value as AutonomyLevel)
    : null;
}

/**
 * The one sentence a create form has to carry. Quoted in the page test —
 * an operator who thinks "create" armed a fixer is wrong, and an operator who
 * thinks it is dangerous will not create one; both failures are what this
 * surface exists to end.
 */
export const CREATE_IS_INERT =
  "Creating this rule arms nothing. Coord has no autonomy_level field on create, so the row lands at " +
  "always_escalate — which coord short-circuits to Escalate regardless of mode. Where coord has no system " +
  "default row for the domain, consults already escalate to you and the only change is the hold marker, " +
  "from escalated_no_policy to escalated_by_policy. Where coord DOES serve a system default above " +
  "always_escalate and no workspace row already overrides it, the new row outranks it and turns that " +
  "default off until you graduate the row. " +
  "Graduating is a separate, deliberate step on the row itself.";

/**
 * Coord's served default for one domain, as the create form knows it.
 *
 * `known` carries the raw wire strings (`default_autonomy_level`,
 * `default_source`, `resolved_from`, `autonomy_level`) rather than narrowed
 * unions, so a value this build does not recognise stays visible as UNKNOWN
 * instead of being coerced.
 */
export type SystemDefaultRead =
  | { state: "loading" }
  | { state: "unknown"; reason: string }
  | {
      state: "known";
      /** `default_autonomy_level`: the system row's level (or the fallback). */
      level: string;
      /** `default_source`: `system_row` | `code_fallback`. */
      source: string | null;
      /** `resolved_from`: which band wins today with no repo in scope. */
      resolvedFrom: string | null;
      /** `autonomy_level`: the winning row's level. */
      currentLevel: string | null;
    };

/** One domain of the `next-step-settings` body, the fields this reads. */
export interface ServedDomainDefault {
  decision_domain: string;
  default_autonomy_level?: string | null;
  default_source?: string | null;
  resolved_from?: string | null;
  autonomy_level?: string | null;
}

/** Pick one domain's served default out of a `next-step-settings` read. */
export function systemDefaultFor(
  domains: readonly ServedDomainDefault[] | null,
  error: string | null,
  decisionDomain: string
): SystemDefaultRead {
  if (error !== null) return { state: "unknown", reason: error };
  if (domains === null) return { state: "loading" };
  const d = domains.find((x) => x.decision_domain === decisionDomain);
  if (!d || typeof d.default_autonomy_level !== "string") {
    return {
      state: "unknown",
      reason: "coord's settings response does not list this domain",
    };
  }
  return {
    state: "known",
    level: d.default_autonomy_level,
    source: d.default_source ?? null,
    resolvedFrom: d.resolved_from ?? null,
    currentLevel: d.autonomy_level ?? null,
  };
}

/** What the form says about coord's default for the chosen domain. */
export type CreateDefaultCaution =
  | { kind: "override"; text: string }
  | { kind: "loading"; text: string }
  | { kind: "unknown"; text: string };

export const READING_DEFAULT_TEXT =
  "Reading coord's current default for this domain…";

/** `resolved_from` values meaning a tenant-side row already beats the default. */
const NON_SYSTEM_BANDS = ["tenant", "repo"];

/**
 * Classify a known read: `system` (the system default — or nothing — wins
 * today), `tenant` (a workspace row already overrides it), or an UNKNOWN
 * reason for a value this build does not recognise.
 */
function classifyRead(
  read: Extract<SystemDefaultRead, { state: "known" }>
):
  | { band: "system"; activeRow: boolean; level: string }
  | { band: "tenant"; currentLevel: string | null }
  | { band: "unknown"; reason: string } {
  const { level, source, resolvedFrom } = read;
  if (resolvedFrom !== null && NON_SYSTEM_BANDS.includes(resolvedFrom)) {
    return { band: "tenant", currentLevel: read.currentLevel };
  }
  if (resolvedFrom !== "system") {
    return {
      band: "unknown",
      reason: `coord reported an unrecognised resolved_from: ${resolvedFrom ?? "none"}`,
    };
  }
  if (source === "code_fallback") return { band: "system", activeRow: false, level };
  if (source !== "system_row") {
    return {
      band: "unknown",
      reason: `coord reported an unrecognised default source: ${source ?? "none"}`,
    };
  }
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(level)) {
    return {
      band: "unknown",
      reason: `coord reported an unrecognised default level: ${level}`,
    };
  }
  return { band: "system", activeRow: level !== "always_escalate", level };
}

/**
 * Is this row coord's SYSTEM row (system tenant, band 2)? Coord marks two
 * different rows `built_in` (`policies/routes.rs`, the list annotation): the
 * system row itself (`system_rule_id` = its own id), and a tenant's
 * customize-override of it (`override_state: customized`, `system_rule_id` =
 * the system row's id). The override is the TENANT's own row — it ranks in
 * the tenant band and the tenant may edit it.
 */
export function isCoordSystemRow(row: CoordPolicyRow): boolean {
  return (
    row.built_in === true &&
    (row.system_rule_id === null || row.system_rule_id === row.policy_id)
  );
}

/** Does coord serve this row at all? Disabled and expired rows it skips. */
export function isLiveRow(
  row: Pick<CoordPolicyRow, "enabled" | "expires_at">,
  now: number = Date.now()
): boolean {
  return (
    row.enabled !== false &&
    !(row.expires_at !== null && Date.parse(row.expires_at) <= now)
  );
}

/** One existing row competing for the same (domain, repo) scope. */
export interface SameScopeRow {
  name: string;
  autonomy_level: string;
  priority: number;
  /** Coord's tie-break after priority: the older row ranks first. */
  created_at: string;
  /** Coord's last tie-break, after `created_at`. */
  policy_id: string;
}

/**
 * What the form knows about existing rows scoped to the target repo:
 * `loaded: false` when the page's list read has not (successfully) answered.
 */
export type RepoBand =
  | { loaded: false }
  | { loaded: true; rows: readonly SameScopeRow[] };

/**
 * The page's loaded rows that compete with a row in the SAME BAND: same
 * domain, same repo scope, same tenant — minus the row being edited and any
 * row disabled or past its `expires_at` (coord serves neither).
 * `rows === null` means the list is not loaded.
 *
 * Band matters because coord ranks `scope_band` before priority
 * (`policies/resolver.rs` `fetch_policies_by_domain`: repo 0, tenant 1, any
 * system-tenant row 2), so a system seed never competes with a tenant row on
 * priority. `bandTenantId` is the competing row's tenant when known (an
 * edited row's `tenant_id`); without it, coord's system rows are the ones
 * excluded (see [`isCoordSystemRow`] — a tenant's customize-override is
 * `built_in` too, and does compete).
 */
export function sameScopeRows(
  rows: readonly CoordPolicyRow[] | null,
  decisionDomain: string,
  repo: string,
  excludePolicyId: string | null,
  bandTenantId: string | null = null,
  now: number = Date.now()
): RepoBand {
  if (rows === null) return { loaded: false };
  const scoped = repo.trim();
  return {
    loaded: true,
    rows: rows
      .filter(
        (r) =>
          isLiveRow(r, now) &&
          (bandTenantId !== null
            ? r.tenant_id === bandTenantId
            : !isCoordSystemRow(r)) &&
          r.decision_domain === decisionDomain &&
          (r.repo ?? "") === scoped &&
          r.policy_id !== excludePolicyId
      )
      .map((r) => ({
        name: r.name,
        autonomy_level: r.autonomy_level,
        priority: r.priority,
        created_at: r.created_at,
        policy_id: r.policy_id,
      })),
  };
}

/**
 * A sortable key for a coord timestamp: whole seconds, then the fractional
 * digits padded to nanoseconds. `Date.parse` alone keeps only milliseconds,
 * and a raw string compare misorders fractions of different lengths
 * (`…:00.5Z` vs `…:00.45Z`). `null` when the value does not parse.
 */
function createdKey(value: string): [number, string] | null {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    value.trim()
  );
  if (!m) return null;
  const seconds = Date.parse(`${m[1]}${m[3] ?? "Z"}`);
  if (Number.isNaN(seconds)) return null;
  return [seconds, (m[2] ?? "").padEnd(9, "0").slice(0, 9)];
}

/** -1 / 0 / 1: is `a` older than `b`? Unparseable values compare as text. */
function compareCreated(a: string, b: string): number {
  const ka = createdKey(a);
  const kb = createdKey(b);
  if (ka && kb) {
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
    if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

type RankRow = {
  name: string;
  autonomy_level: string;
  priority: number;
  created_at: string;
  policy_id: string;
};

/**
 * Coord's in-band order (`ORDER BY … priority ASC, created_at ASC,
 * policy_id ASC`): lower priority number first, then the older row, then the
 * lower policy id.
 */
export function ranksAbove(a: RankRow, b: RankRow): boolean {
  if (a.priority !== b.priority) return a.priority < b.priority;
  const c = compareCreated(a.created_at, b.created_at);
  if (c !== 0) return c < 0;
  return a.policy_id < b.policy_id;
}

function topOf<T extends RankRow>(rows: readonly T[]): T | null {
  let top: T | null = null;
  for (const r of rows) if (top === null || ranksAbove(r, top)) top = r;
  return top;
}

/**
 * The caution for an in-place PATCH that changes ONLY the priority (the scope
 * is unchanged), or `null` when the winner of the scope does not change or
 * the winner's level does not differ.
 *
 * Coord takes the first row by priority, then age, within a band — so a
 * priority edit can hand the scope to this row, or away from it, and
 * consults then take the winner's level. `band` must hold only rows in the
 * edited row's band (see [`sameScopeRows`]).
 */
export function priorityEditCaution(
  band: RepoBand,
  self: {
    name: string;
    autonomy_level: string;
    created_at: string;
    policy_id: string;
    oldPriority: number;
    newPriority: number;
    /** A disabled or expired row competes with nothing (see [`isLiveRow`]). */
    live?: boolean;
  },
  repo: string
): string | null {
  if (self.oldPriority === self.newPriority) return null;
  if (self.live === false) return null;
  const scope = repo.trim() !== "" ? repo.trim() : "the workspace";
  if (!band.loaded) {
    return (
      `Changing the priority can reorder this row against other rows for ${scope}; this workspace's ` +
      `existing rows could not be read, so which row wins there is UNKNOWN.`
    );
  }
  const as = (priority: number): RankRow => ({
    name: self.name,
    autonomy_level: self.autonomy_level,
    created_at: self.created_at,
    policy_id: self.policy_id,
    priority,
  });
  const selfOld = as(self.oldPriority);
  const selfNew = as(self.newPriority);
  const before = topOf([...band.rows, selfOld]);
  const after = topOf([...band.rows, selfNew]);
  if (before === null || after === null) return null;
  const selfBefore = before === selfOld;
  const selfAfter = after === selfNew;
  if (selfBefore === selfAfter) return null;
  if (selfAfter) {
    if (before.autonomy_level === self.autonomy_level) return null;
    return (
      `This row now ranks above "${before.name}" (${before.autonomy_level}) for ${scope} — consults ` +
      `take this row's ${self.autonomy_level}.`
    );
  }
  if (after.autonomy_level === self.autonomy_level) return null;
  return (
    `This row now ranks below "${after.name}" (${after.autonomy_level}) for ${scope} — consults take ` +
    `${after.autonomy_level} instead of this row's ${self.autonomy_level}.`
  );
}

/**
 * The caution for a replace that keeps the domain AND the scope, or `null`.
 *
 * The replacement is a NEW row: it lands at `always_escalate`, carries the
 * form's priority, and is the newest row in the band — so it loses every
 * equal-priority tie the old row may have won. Runs the same winner
 * computation as [`priorityEditCaution`] with the old row removed and the
 * replacement added; cautions only when the scope's winner moves to or from
 * this row and the winning level changes. (Old row → replacement is the
 * de-graduation the replace note already states.)
 */
export function replaceRankCaution(
  band: RepoBand,
  old: RankRow,
  newPriority: number,
  repo: string,
  nowIso: string = new Date().toISOString(),
  oldLive = true
): string | null {
  const scope = repo.trim() !== "" ? repo.trim() : "the workspace";
  if (!band.loaded) {
    return (
      `The replacement is the newest row for ${scope}, so it loses equal-priority ties the old row ` +
      `won; this workspace's existing rows could not be read, so which row wins there is UNKNOWN.`
    );
  }
  const replacement: RankRow = {
    name: old.name,
    autonomy_level: "always_escalate",
    priority: newPriority,
    created_at: nowIso,
    policy_id: "",
  };
  // A disabled or expired old row competes with nothing; the replacement is
  // created enabled, so it does.
  const before = topOf(oldLive ? [...band.rows, old] : band.rows);
  const after = topOf([...band.rows, replacement]);
  if (before === null || after === null) return null;
  const selfBefore = before === old;
  const selfAfter = after === replacement;
  if (selfBefore === selfAfter) return null;
  if (before.autonomy_level === after.autonomy_level) return null;
  if (selfAfter) {
    return (
      `The replacement ranks above "${before.name}" (${before.autonomy_level}) for ${scope} — consults ` +
      `take the replacement's always_escalate.`
    );
  }
  return (
    `The replacement is the newest row, so it ranks below "${after.name}" (${after.autonomy_level}) ` +
    `for ${scope} — consults take ${after.autonomy_level} instead of this row's ${old.autonomy_level}.`
  );
}

/**
 * The settings read with the edited row taken out of the tenant band: when
 * coord says `resolved_from: tenant` but the ONLY enabled workspace row in
 * the loaded list is the row a replace is about to delete, the tenant band
 * is empty afterwards and the system default is what the other scopes see.
 * Anything short of a loaded list proving that leaves the read unchanged.
 */
export function readWithoutDeletedWorkspaceRow(
  read: SystemDefaultRead,
  workspaceBandWithoutOld: RepoBand
): SystemDefaultRead {
  if (read.state !== "known" || read.resolvedFrom !== "tenant") return read;
  if (!workspaceBandWithoutOld.loaded) return read;
  if (workspaceBandWithoutOld.rows.length > 0) return read;
  return { ...read, resolvedFrom: "system", currentLevel: read.level };
}

/**
 * The sentence for a row that would land in an already-occupied repo scope,
 * or `null` when the scope is empty. `level` is the level the new/moved row
 * will carry there.
 */
function occupiedRepoText(
  band: Extract<RepoBand, { loaded: true }>,
  repo: string,
  level: string
): string | null {
  if (band.rows.length === 0) return null;
  const named = band.rows
    .map(
      (r) =>
        `"${r.name}" (at ${r.autonomy_level}, priority ${r.priority})`
    )
    .join(", ");
  const armed = band.rows.filter((r) => r.autonomy_level !== "always_escalate");
  const disarm =
    armed.length > 0 && level === "always_escalate"
      ? ` Because ${armed.map((r) => `"${r.name}"`).join(", ")} ${armed.length === 1 ? "is" : "are"} ` +
        `above always_escalate, a new row at always_escalate that outranks ${armed.length === 1 ? "it" : "them"} ` +
        `may disarm ${armed.length === 1 ? "it" : "them"} for ${repo}.`
      : "";
  return (
    `A row scoped to ${repo} already exists for this domain: ${named}. This row takes effect for ` +
    `${repo} only if it outranks ${band.rows.length === 1 ? "it" : "them"} (lower priority number, then ` +
    `older), and then at ${level}.${disarm}`
  );
}

/** Appended to a repo-scoped claim when the workspace's rows are unread. */
function unreadRepoQualifier(repo: string): string {
  return (
    ` This holds unless another row scoped to ${repo} ranks above it — this workspace's existing rows ` +
    `could not be read.`
  );
}

/**
 * Where a scope this row stops covering goes back to: coord's default, named
 * with its level when the read knows it.
 */
function defaultFallbackPhrase(read: SystemDefaultRead): string {
  if (read.state !== "known") return "coord's default";
  const c = classifyRead(read);
  if (c.band === "system") {
    return c.activeRow || read.source === "system_row"
      ? `coord's default (at ${c.level})`
      : "coord's default (no system row — consults escalate)";
  }
  return "coord's default";
}

/**
 * Can coord DISPATCH at this level in this domain? Only `auto_decide` acts
 * (`next_step_settings::effective` requires it; `guidance_only` frames and
 * never dispatches), and only a domain with an autodispatch arm
 * (`requiresMaster`) has anything to dispatch — `architecture_tradeoff` and
 * `verification_sufficiency` have none.
 */
function dispatchesAt(domain: string, level: string): boolean {
  return level === "auto_decide" && domainSpec(domain)?.requiresMaster === true;
}

/**
 * The restore sentence for a scope that goes back to coord's default, or ""
 * when nothing is restored. It says "re-arm dispatch" ONLY where coord can
 * dispatch (see [`dispatchesAt`]); otherwise it says which frame comes back.
 * `target` names the released scope, `goesBack` is its "goes back" clause,
 * and `them` its pronoun. `fromRepo` says whether the released row was
 * repo-scoped (then a workspace override catches it, so the tenant-band arm
 * does not apply).
 */
function rearmSuffix(
  read: SystemDefaultRead,
  fromRepo: string,
  target: string,
  goesBack: string,
  them: string,
  domain: string
): string {
  const effect = (level: string, who: string) =>
    dispatchesAt(domain, level)
      ? `can re-arm dispatch for ${who}`
      : `restores coord's ${level} frame for ${who}`;
  if (read.state !== "known") {
    return domainSpec(domain)?.requiresMaster === true
      ? ` This can restore a coord system default for ${target} (and, if it is auto_decide, re-arm dispatch).`
      : ` This can restore a coord system default for ${target}.`;
  }
  const c = classifyRead(read);
  if (c.band === "system" && c.activeRow) {
    return ` With coord's system default at ${c.level}, this ${effect(c.level, target)}.`;
  }
  if (c.band === "tenant" && fromRepo === "") {
    const def = read.source === "system_row" ? ` (at ${read.level})` : "";
    return (
      ` If this row is the workspace row that wins today, ${goesBack} to coord's default${def}` +
      (read.source === "system_row" && read.level !== "always_escalate"
        ? `, which ${effect(read.level, them)}.`
        : ".")
    );
  }
  return "";
}

/**
 * The clause for a scope a save RELEASES — a repo row leaving its repo, a
 * workspace row narrowing to one repo, or (with `oldDomain`) a replace that
 * moves the row to another domain, so the OLD domain loses it. Shared by the
 * in-place PATCH caution and the replace caution so they cannot drift.
 *
 * `read` is coord's served default for `domain`, the domain that loses the
 * row. `domainChanged` says the row is moving to ANOTHER domain, so `domain`
 * as a whole loses it.
 */
export function releaseClause(
  read: SystemDefaultRead,
  fromRepo: string,
  toRepo: string,
  domain: string,
  domainChanged = false
): string {
  const from = fromRepo.trim();
  const to = toRepo.trim();
  const fallback = defaultFallbackPhrase(read);
  if (domainChanged) {
    const where = from !== "" ? `${domain} for ${from}` : domain;
    return (
      `${where} loses this row and goes back to another row or ${fallback}.` +
      rearmSuffix(read, from, where, `${where} goes back`, "it", domain)
    );
  }
  if (from !== "") {
    return `${from} stops using this row and goes back to another workspace row or ${fallback}.`;
  }
  return (
    `Repos other than ${to} stop using this row and go back to ${fallback}, unless another ` +
    `workspace row covers them.` +
    rearmSuffix(read, from, "those repos", "those repos go back", "them", domain)
  );
}

/**
 * The per-domain caution the create form carries, or `null` when a new row
 * provably overrides nothing.
 *
 *  - `override` — coord serves a `system_row` default above `always_escalate`
 *    and nothing in the tenant band beats it, so creating a row turns it off;
 *    or a workspace row already overrides it (`resolved_from` `tenant`), so a
 *    new row's effect depends on outranking that row.
 *  - `loading` — the read has not answered yet.
 *  - `unknown` — the read failed, the domain is missing, or coord sent a
 *    source/level/`resolved_from` this build does not know. An unread default
 *    is never treated as absent.
 *  - `null` — a `code_fallback` default (no row: the resolver already
 *    escalates), or a system row already at `always_escalate`.
 *
 * `repo` is the scope the row would actually be written with — pass it AFTER
 * dropping a repo the domain cannot serve (see [`effectiveCreateRepo`]).
 * `repoBand` is what the page knows about rows already scoped to that repo
 * (see [`sameScopeRows`]); omitted, it is read as NOT loaded.
 */
export function createDefaultCaution(
  read: SystemDefaultRead,
  repo: string,
  repoBand: RepoBand = { loaded: false }
): CreateDefaultCaution | null {
  const scoped = repo.trim();
  // The repo band outranks both bands the (repo-less) settings read can see,
  // so an occupied repo scope decides the sentence on its own.
  if (scoped !== "" && repoBand.loaded) {
    const occupied = occupiedRepoText(repoBand, scoped, "always_escalate");
    if (occupied) return { kind: "override", text: occupied };
  }
  const base = createDefaultCautionIgnoringRepoBand(read, scoped);
  if (base && scoped !== "" && !repoBand.loaded && base.kind !== "loading") {
    return { ...base, text: base.text + unreadRepoQualifier(scoped) };
  }
  return base;
}

function createDefaultCautionIgnoringRepoBand(
  read: SystemDefaultRead,
  scoped: string
): CreateDefaultCaution | null {
  const unknown = (why: string): CreateDefaultCaution => ({
    kind: "unknown",
    text:
      `Could not read coord's current default for this domain (${why}). If coord has a system ` +
      `default above always_escalate, a ${scoped ? `row scoped to ${scoped}` : "workspace-wide row"} ` +
      `created here outranks it and turns it off ${scoped ? `for ${scoped}` : "for your workspace"} ` +
      `until you graduate this row.`,
  });
  if (read.state === "loading") {
    return { kind: "loading", text: READING_DEFAULT_TEXT };
  }
  if (read.state === "unknown") return unknown(read.reason);
  const c = classifyRead(read);
  if (c.band === "unknown") return unknown(c.reason);
  if (c.band === "tenant") {
    const at = c.currentLevel ? ` at ${c.currentLevel}` : "";
    if (scoped === "") {
      return {
        kind: "override",
        text:
          `A workspace row already overrides coord's default for this domain${at}; a new row takes ` +
          `effect only if it outranks that row (lower priority number, then older).`,
      };
    }
    if (c.currentLevel === "always_escalate") return null;
    return {
      kind: "override",
      text:
        `A workspace row already overrides coord's default for this domain${at}. A row scoped to ` +
        `${scoped} outranks it for that repo and takes effect at always_escalate — so creating one turns ` +
        `that off for ${scoped} until you graduate this row.`,
    };
  }
  if (!c.activeRow) return null;
  if (scoped !== "") {
    return {
      kind: "override",
      text:
        `This domain has a coord system default at ${c.level}. A row scoped to ${scoped} outranks it for ` +
        `that repo and takes effect at always_escalate — so creating one turns that default off for ${scoped} ` +
        `until you graduate this row. Other repos keep the default.`,
    };
  }
  return {
    kind: "override",
    text:
      `This domain has a coord system default at ${c.level}. A workspace-wide row created here outranks it ` +
      `and takes effect at always_escalate — so creating one turns that default off for your workspace ` +
      `until you graduate this row. (For the system tenant's own rows, a new row shares the seed's band ` +
      `and must out-prioritise it — and one that does changes the default for every tenant, not one workspace.)`,
  };
}

/**
 * The caution for an in-place PATCH that changes a row's repo scope, or
 * `null` when the scope is unchanged.
 *
 * Unlike a create, a PATCH keeps the row's CURRENT `autonomy_level`, so the
 * row does not "turn a default off" — it outranks whatever it now competes
 * with, at its own level. Moving it OUT of a scope hands that scope back to
 * whatever ranks next there.
 */
export function scopeEditCaution(
  read: SystemDefaultRead,
  fromRepo: string,
  toRepo: string,
  rowLevel: string,
  domain: string,
  repoBand: RepoBand = { loaded: false }
): string | null {
  const from = fromRepo.trim();
  const to = toRepo.trim();
  if (from === to) return null;

  let target: string;
  if (to !== "") {
    const occupied = repoBand.loaded
      ? occupiedRepoText(repoBand, to, rowLevel)
      : null;
    target =
      occupied ??
      `For ${to}, this row will outrank coord's system default and any workspace row at this row's ` +
        `level ${rowLevel}.` +
        (repoBand.loaded ? "" : unreadRepoQualifier(to));
  } else if (read.state === "loading") {
    target =
      `${READING_DEFAULT_TEXT} Workspace-wide, this row outranks coord's system default — if there is ` +
      `one — at this row's level ${rowLevel}.`;
  } else if (read.state === "unknown") {
    target =
      `Could not read coord's current default for this domain (${read.reason}). Workspace-wide, this ` +
      `row outranks coord's system default — if there is one — at this row's level ${rowLevel}.`;
  } else {
    const c = classifyRead(read);
    if (c.band === "tenant") {
      target =
        `A workspace row already overrides coord's default for this domain; workspace-wide, this row ` +
        `takes effect only if it outranks that row (lower priority number, then older), and then at ` +
        `this row's level ${rowLevel}.`;
    } else if (c.band === "unknown") {
      target =
        `Could not read coord's current default for this domain (${c.reason}). Workspace-wide, this ` +
        `row outranks coord's system default — if there is one — at this row's level ${rowLevel}.`;
    } else if (c.activeRow) {
      target =
        `Workspace-wide, this row (at ${rowLevel}) outranks coord's system default (${c.level}) for ` +
        `every repo without its own row.`;
    } else {
      target =
        `Workspace-wide, this row decides consults at this row's level ${rowLevel} for every repo ` +
        `without its own row (coord has no system default row above always_escalate here).`;
    }
  }
  return `${target} ${releaseClause(read, from, to, domain)}`;
}

/** The repo a create body will carry for this domain: blank for a domain
 *  whose consults carry no repo (a repo-scoped row there never serves). */
export function effectiveCreateRepo(
  decisionDomain: string,
  repo: string | undefined
): string {
  if (domainSpec(decisionDomain)?.repoScoped === false) return "";
  return repo?.trim() ?? "";
}

/** Why the repo field is not offered for a repo-less domain. */
export const REPO_NOT_SERVED_NOTE =
  "Coord consults this domain with no repo, so a repo-scoped row would never take effect. " +
  "Rows for this domain are workspace-wide.";

/** Why `auto_decide` may still not act, for the master-gated domains. */
export const MASTER_FLAG_CAVEAT =
  "auto_decide is necessary but not sufficient for this domain: coord also requires this domain's own " +
  "autodispatch env flag (and, for the fixer domains, the tenant or repo auto-fix opt-in). Graduating here " +
  "does not arm those.";

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/** One thing coord would silently drop, or silently not find, in a payload. */
export interface PayloadIssue {
  /** Dotted path within the payload, e.g. `constraints[2].severity`. */
  path: string;
  message: string;
}

export type PayloadValidation =
  | { ok: false; error: string }
  | {
      ok: true;
      value: Record<string, unknown>;
      /** Fields coord's parser would DROP. Never blocking — coord accepts the
       *  write either way, which is exactly why they must be shown. */
      warnings: PayloadIssue[];
      /** Top-level keys no coord reader for this mode consults. */
      unread: string[];
    };

/** Keys coord's `parse_guidance_payload` reads, per mode. */
const READ_KEYS: Record<DecisionPolicyMode, readonly string[]> = {
  guidance: ["constraints", "rubric", "notes"],
  data_driven: ["constraints", "rubric", "notes", "query"],
};

/**
 * Validate the raw JSON text an operator typed.
 *
 * Two very different failures, kept apart on purpose:
 *
 *  - **Blocking** — the text is not JSON, or is JSON that is not an object.
 *    Coord would answer 400/422; catching it here is a better experience than
 *    a round trip, and the form refuses to send.
 *  - **Non-blocking warnings** — structurally wrong fields. Coord's
 *    `parse_guidance_payload` (`policies/decide.rs:5992`) is deliberately
 *    lenient: *"A malformed field is skipped (robust — a guidance policy with
 *    a bad rubric still serves its priority frame)"*. So a bad `rubric` is
 *    stored, returns 201, and is **silently never served**. Nothing else in
 *    the product would tell the operator that; this does.
 *
 * `Vec<Constraint>` deserializes as a UNIT — one malformed entry drops the
 * WHOLE array, not just that entry. The message says so, because "constraint 3
 * is wrong" and "none of your nine constraints will be applied" are very
 * different facts.
 */
export function validateDecisionPayload(
  text: string,
  mode: DecisionPolicyMode
): PayloadValidation {
  const trimmed = text.trim();
  if (trimmed === "") {
    return {
      ok: false,
      error:
        "A payload is required. Use {} for a rule that carries no constraints or rubric.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      ok: false,
      error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        "The payload must be a JSON object — coord reads it by key (constraints / rubric / notes).",
    };
  }
  const value = parsed as Record<string, unknown>;
  const warnings: PayloadIssue[] = [];

  if ("constraints" in value) checkConstraints(value.constraints, warnings);
  if ("rubric" in value) checkRubric(value.rubric, warnings);
  if ("notes" in value && typeof value.notes !== "string") {
    warnings.push({
      path: "notes",
      message: "coord reads `notes` only when it is a string; this value is dropped.",
    });
  }
  if (mode === "data_driven" && !("query" in value)) {
    warnings.push({
      path: "query",
      message:
        "A data_driven row with no `query` object serves the plain priority frame — coord logs it and carries on. Use mode `guidance` if that is what you meant.",
    });
  }

  const read = READ_KEYS[mode];
  const unread = Object.keys(value).filter((k) => !read.includes(k));
  return { ok: true, value, warnings, unread };
}

const SEVERITIES = ["hard", "soft"];

function checkConstraints(raw: unknown, out: PayloadIssue[]): void {
  const drops = (path: string, why: string) =>
    out.push({
      path,
      message: `${why} coord deserializes \`constraints\` as one unit, so EVERY constraint in this rule is dropped, not just this entry.`,
    });

  if (!Array.isArray(raw)) {
    out.push({
      path: "constraints",
      message:
        "`constraints` must be an array of {severity, check, rationale?}; coord drops the whole field otherwise.",
    });
    return;
  }
  raw.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      drops(`constraints[${i}]`, "Each constraint must be an object.");
      return;
    }
    const c = entry as Record<string, unknown>;
    if (typeof c.severity !== "string" || !SEVERITIES.includes(c.severity)) {
      drops(
        `constraints[${i}].severity`,
        'severity must be exactly "hard" or "soft".'
      );
    }
    if (typeof c.check !== "string" || c.check.trim() === "") {
      drops(`constraints[${i}].check`, "check must be a non-empty string.");
    }
    if ("rationale" in c && typeof c.rationale !== "string") {
      drops(
        `constraints[${i}].rationale`,
        "rationale, when present, must be a string."
      );
    }
  });
}

function checkRubric(raw: unknown, out: PayloadIssue[]): void {
  const drops = (path: string, why: string) =>
    out.push({
      path,
      message: `${why} coord drops the whole rubric, and the frame is served with no scoring instructions.`,
    });

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    drops("rubric", "`rubric` must be an object {instructions, score_on?}.");
    return;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.instructions !== "string" || r.instructions.trim() === "") {
    drops("rubric.instructions", "instructions must be a non-empty string.");
  }
  if (
    "score_on" in r &&
    (!Array.isArray(r.score_on) || r.score_on.some((s) => typeof s !== "string"))
  ) {
    drops("rubric.score_on", "score_on must be an array of strings.");
  }
}

/**
 * What the form CANNOT check, stated rather than implied. Coord publishes no
 * client-readable schema for a `query` spec (the registered query ids live
 * server-side in `NamedQuery::from_payload`), so a `data_driven` payload is
 * only shape-checked here.
 */
export const UNVALIDATED_NOTE: Record<DecisionPolicyMode, string | null> = {
  guidance: null,
  data_driven:
    "The `query` object is NOT validated here: the registered query ids live server-side and coord publishes no schema for them. An unregistered id is accepted on write and falls back to the plain priority frame at decision time.",
};

/** Pretty-print a stored payload for the editor's textarea. */
export function payloadToText(payload: unknown): string {
  if (payload === null || payload === undefined) return "{}";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return "{}";
  }
}

/** Stable text for comparing a stored payload against an edited one, so a
 *  reformat-only edit is not mistaken for a payload change (which would take
 *  the destructive REPLACE path for nothing). */
export function canonicalPayload(payload: unknown): string {
  return JSON.stringify(sortKeys(payload));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Wire bodies
// ---------------------------------------------------------------------------

/**
 * `POST /coord/policies` body — the v2 shape and nothing else.
 *
 * ⚠️ **No `autonomy_level`, deliberately and permanently.** Coord's
 * `CreatePolicyRequest` has no such field (coord#920): graduation is an
 * explicit, auditable PATCH boundary, and a create form that offered the dial
 * would be offering a field the server silently ignores.
 *
 * ⚠️ **No `kind` / `condition` / `action`.** Coord's `derive_create_shape`
 * 400s a request mixing the two shapes, and the v1 shape is what authors
 * fleet-wide terminal injection and escalation suppression — not this page.
 */
export interface DecisionPolicyCreate {
  name: string;
  decision_domain: string;
  mode: DecisionPolicyMode;
  payload: Record<string, unknown>;
  repo?: string;
  priority?: number;
  rationale?: string;
}

/**
 * `PATCH /coord/policies/:id` body for a decision policy.
 *
 * ⚠️ **No `payload`.** Coord's `UpdatePolicyRequest` carries no such field, so
 * a payload edit is a row REPLACE (`useDecisionPolicies.replaceRule`), not a
 * PATCH. A PATCH-shaped "save" would silently keep the old payload.
 *
 * ⚠️ **No `enabled`,** for the reason `gate-clearance/gateClearance.ts` records
 * in full: `DELETE /coord/policies/:id` is a soft delete onto exactly that
 * column and `coord.policy_rules` has no tombstone, so `{enabled:false}` is
 * the delete under a name that denies it.
 *
 * `autonomy_level` is PATCHable and is the graduation — it is kept in its own
 * body type so it can never ride along unnoticed with a name edit.
 */
export interface DecisionPolicyUpdate {
  name?: string;
  /** `null` clears the repo scope (coord's `Option<Option<String>>`). */
  repo?: string | null;
  priority?: number;
  rationale?: string;
}

/** The graduation PATCH, alone in its own body. */
export interface DecisionPolicyGraduation {
  autonomy_level: AutonomyLevel;
}

export interface DecisionPolicyInput {
  name: string;
  decisionDomain: string;
  mode: DecisionPolicyMode;
  /** Already validated by [`validateDecisionPayload`]. */
  payload: Record<string, unknown>;
  repo?: string;
  priority?: number;
  rationale?: string;
}

export function buildCreateBody(
  input: DecisionPolicyInput
): DecisionPolicyCreate {
  const body: DecisionPolicyCreate = {
    name: input.name.trim(),
    decision_domain: input.decisionDomain,
    mode: input.mode,
    payload: input.payload,
  };
  const repo = effectiveCreateRepo(input.decisionDomain, input.repo);
  if (repo) body.repo = repo;
  if (input.priority !== undefined) body.priority = input.priority;
  const rationale = input.rationale?.trim();
  if (rationale) body.rationale = rationale;
  return body;
}
