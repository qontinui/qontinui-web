/**
 * `gate_clearance` — the per-tenant clearance-authority matrix, client side.
 *
 * A `gate_clearance` rule is a **v2 decision-domain** `coord.policy_rules` row:
 * `decision_domain = 'gate_clearance'`, `mode = 'data_driven'`, `kind = NULL`,
 * `payload = {"gate_class": "<class>", "authority": "operator_only" |
 * "agent_non_author" | "agent_any"}` (coord `gates_authority.rs:7-10`). It
 * decides WHO MAY CLEAR a coord gate carrying that `gate_class`.
 *
 * Everything in this module is PURE and mirrors coord's own resolution, so the
 * console can show the *effective* authority per class rather than only the
 * rows the tenant happens to have written. The two sides it mirrors:
 *
 *  - `policies::resolver::fetch_policies_by_domain` — the candidate set and its
 *    order: `enabled = true`, unexpired, tenant band ∪ system band, ordered
 *    `scope_band ASC, priority ASC, created_at ASC`. Gates carry no repo, so
 *    the resolver queries with `repo: None` and a repo-scoped row can NEVER
 *    match (coord's create route rejects new ones with a 400, but rows written
 *    before that guard can still exist).
 *  - `gates_authority::pick_rule` — first row whose `payload.gate_class`
 *    equals the gate's class **exactly** and whose `payload.authority` parses;
 *    a row with a missing/mismatched class or an unparseable authority is
 *    SKIPPED, never a fallback to a different row's class.
 *  - `gates_authority::default_authority` — no matching rule ⇒ the
 *    AUDIENCE default: `operator` ⇒ `operator_only`, `agent` ⇒ `agent_any`.
 *
 * The class is freeform TEXT server-side — coord's `normalize_gate_class` only
 * trims and blank-filters, there is no CHECK and no Rust enum. Matching is
 * therefore byte-exact and case-sensitive, which is why
 * [`nearMissRecommendedClass`] exists: a typo'd class silently matches nothing
 * and every gate in it falls to the audience default.
 */

import type { CoordPolicyRow } from "../_shared/coordPolicies";

/** The decision domain these rules live under (coord `GATE_CLEARANCE_DOMAIN`). */
export const GATE_CLEARANCE_DOMAIN = "gate_clearance";

/** The v2 `mode` a `gate_clearance` row carries. */
export const GATE_CLEARANCE_MODE = "data_driven";

/** Who may clear a gate of a given class (coord `ClearanceAuthority`). */
export type ClearanceAuthority =
  | "operator_only"
  | "agent_non_author"
  | "agent_any";

/** The exact vocabulary coord's `ClearanceAuthority::parse` accepts. */
export const CLEARANCE_AUTHORITIES: readonly ClearanceAuthority[] = [
  "operator_only",
  "agent_non_author",
  "agent_any",
] as const;

/** Short label for an authority. */
export const AUTHORITY_LABELS: Record<ClearanceAuthority, string> = {
  operator_only: "Operator only",
  agent_non_author: "Any agent except the author",
  agent_any: "Any agent",
};

/** What each authority means, in the user's terms. */
export const AUTHORITY_DESCRIPTIONS: Record<ClearanceAuthority, string> = {
  operator_only:
    "Only a signed-in human operator may clear a gate in this class. Agents and device sessions are refused.",
  agent_non_author:
    "Any agent may clear a gate in this class except the identity that registered it (separation of duties).",
  agent_any:
    "Any agent or device session in this workspace may clear a gate in this class — including the one that registered it.",
};

/**
 * `agent_non_author` refuses when either side's identity is indeterminate
 * (coord `non_author_allows` fails closed on a NULL `registered_by` or a
 * device-less caller). Coord's own internal gate producers register with
 * `registered_by: None` today, so on a single-machine fleet this arm can refuse
 * everything — say so at the point of choice rather than offering it blind.
 * (Plan `2026-08-10-agent-gate-management-must-ship-in-the-product` §4 "Null C";
 * P2 is the phase that makes it satisfiable.)
 */
export const AGENT_NON_AUTHOR_CAVEAT =
  "On a single-machine fleet this can refuse every clear: coord fails closed when either " +
  "the gate's registrant or the caller has no resolvable identity, and coord's own " +
  "auto-registered gates carry none. Verify against a real gate before relying on it.";

/** The three classes coord's own derivation and system-band seeds use. */
export const RECOMMENDED_GATE_CLASSES = [
  "security-surface",
  "routine-review",
  "ops-confirm",
] as const;

export type RecommendedGateClass = (typeof RECOMMENDED_GATE_CLASSES)[number];

/** What each recommended class is for, shown at the point of choice. */
export const GATE_CLASS_DESCRIPTIONS: Record<string, string> = {
  "security-surface":
    "Gates guarding a change to who may act — authorization, allow-sets, credentials.",
  "routine-review":
    "Gates on independently re-checkable observations — a PR merged, a ref exists, a commit is live.",
  "ops-confirm":
    "Gates on a persisted deploy or infrastructure observation — a deploy healthy, a migration at head.",
};

/** A gate's `clearance_audience` — the only input to the no-rule default. */
export type ClearanceAudience = "operator" | "agent";

/** Which band a row came from. `built_in` is coord's own annotation on the
 *  effective-set list route; a tenant row always outranks a system row. */
export type RuleBand = "tenant" | "system";

export function ruleBand(row: CoordPolicyRow): RuleBand {
  return row.built_in ? "system" : "tenant";
}

/** Band precedence, mirroring the resolver's `scope_band` (tenant 1, system 2). */
function bandRank(row: CoordPolicyRow): number {
  return row.built_in ? 2 : 1;
}

/** Is this row a `gate_clearance` rule at all? */
export function isGateClearanceRow(row: CoordPolicyRow): boolean {
  return row.decision_domain === GATE_CLEARANCE_DOMAIN;
}

/** The `{gate_class, authority}` a row carries, or `null` when coord's
 *  `pick_rule` would skip it (no payload / no class / unparseable authority). */
export function parseGateClearancePayload(
  payload: unknown
): { gate_class: string; authority: ClearanceAuthority } | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const cls = p.gate_class;
  const auth = p.authority;
  if (typeof cls !== "string" || cls.length === 0) return null;
  if (typeof auth !== "string") return null;
  if (!(CLEARANCE_AUTHORITIES as readonly string[]).includes(auth)) return null;
  return { gate_class: cls, authority: auth as ClearanceAuthority };
}

/** The raw `payload.gate_class` string, even when the row is otherwise
 *  unusable — needed so an unparseable row is still listed under its class. */
export function rawGateClass(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const cls = (payload as Record<string, unknown>).gate_class;
  return typeof cls === "string" ? cls : null;
}

/**
 * Why coord's resolver would never see this row. `null` = the row participates.
 * Each arm names a clause of `fetch_policies_by_domain` / `pick_rule`.
 */
export type InertReason =
  | "disabled"
  | "repo-scoped"
  | "expired"
  | "no-class"
  | "unknown-authority";

export const INERT_EXPLANATIONS: Record<InertReason, string> = {
  disabled: "Disabled — coord only resolves enabled rules.",
  "repo-scoped":
    "Scoped to a repo. Gates carry no repo, so a repo-scoped rule can never match.",
  expired: "Expired — coord only resolves unexpired rules.",
  "no-class": "No `payload.gate_class` — coord skips rules it cannot key.",
  "unknown-authority":
    "`payload.authority` is not one of operator_only / agent_non_author / agent_any — coord skips the rule.",
};

export function inertReason(
  row: CoordPolicyRow,
  now: number = Date.now()
): InertReason | null {
  if (!row.enabled) return "disabled";
  // The resolver binds `repo.unwrap_or("")` for a gate, so only NULL (or the
  // degenerate empty string) can satisfy `repo IS NULL OR repo = $3`.
  if (row.repo !== null && row.repo !== "") return "repo-scoped";
  if (row.expires_at !== null) {
    const t = new Date(row.expires_at).getTime();
    if (!Number.isNaN(t) && t <= now) return "expired";
  }
  if (rawGateClass(row.payload) === null) return "no-class";
  if (parseGateClearancePayload(row.payload) === null)
    return "unknown-authority";
  return null;
}

/** A row that coord's resolver would actually consider, with its parsed body. */
export interface ResolutionCandidate {
  row: CoordPolicyRow;
  gate_class: string;
  authority: ClearanceAuthority;
  band: RuleBand;
}

/**
 * The candidate set in coord's own precedence order:
 * `scope_band ASC, priority ASC, created_at ASC`, with every inert row dropped.
 * A tenant row therefore beats a system row REGARDLESS of numeric priority.
 */
export function resolutionCandidates(
  rows: readonly CoordPolicyRow[],
  now: number = Date.now()
): ResolutionCandidate[] {
  return rows
    .filter((r) => isGateClearanceRow(r) && inertReason(r, now) === null)
    .map((row) => {
      // `inertReason === null` guarantees the payload parses.
      const parsed = parseGateClearancePayload(row.payload)!;
      return {
        row,
        gate_class: parsed.gate_class,
        authority: parsed.authority,
        band: ruleBand(row),
      };
    })
    .sort((a, b) => {
      const band = bandRank(a.row) - bandRank(b.row);
      if (band !== 0) return band;
      const prio = a.row.priority - b.row.priority;
      if (prio !== 0) return prio;
      return a.row.created_at < b.row.created_at
        ? -1
        : a.row.created_at > b.row.created_at
          ? 1
          : 0;
    });
}

/**
 * The effective authority for a class. `kind: "audience-default"` is the
 * honest no-rule answer: coord's default is AUDIENCE-dependent, so there is no
 * single authority to report — both arms are returned rather than one guessed.
 */
export type EffectiveAuthority =
  | {
      kind: "rule";
      authority: ClearanceAuthority;
      band: RuleBand;
      rule: CoordPolicyRow;
      /** Lower-precedence rules for the same class that never get consulted. */
      shadowed: ResolutionCandidate[];
    }
  | {
      kind: "audience-default";
      /** Coord `default_authority("operator")`. */
      operatorAudience: "operator_only";
      /** Coord `default_authority("agent")`. */
      agentAudience: "agent_any";
    };

export const AUDIENCE_DEFAULT: Extract<
  EffectiveAuthority,
  { kind: "audience-default" }
> = {
  kind: "audience-default",
  operatorAudience: "operator_only",
  agentAudience: "agent_any",
};

/**
 * Resolve `gateClass` against a rule set exactly as coord does. Matching is
 * byte-exact — `"Security-Surface"` and `"security-surface "` are DIFFERENT
 * classes and neither matches `"security-surface"`.
 */
export function resolveEffectiveAuthority(
  rows: readonly CoordPolicyRow[],
  gateClass: string,
  now: number = Date.now()
): EffectiveAuthority {
  const matches = resolutionCandidates(rows, now).filter(
    (c) => c.gate_class === gateClass
  );
  const [winner, ...shadowed] = matches;
  if (!winner) return AUDIENCE_DEFAULT;
  return {
    kind: "rule",
    authority: winner.authority,
    band: winner.band,
    rule: winner.row,
    shadowed,
  };
}

/** The single authority a gate of `audience` would actually get. */
export function authorityForAudience(
  effective: EffectiveAuthority,
  audience: ClearanceAudience
): ClearanceAuthority {
  if (effective.kind === "rule") return effective.authority;
  return audience === "agent"
    ? effective.agentAudience
    : effective.operatorAudience;
}

/**
 * What would decide `gateClass` if `policyId` were removed — the consequence
 * preview a delete/disable confirmation must show, computed from the same
 * resolver rather than described in prose.
 */
export function resolveWithout(
  rows: readonly CoordPolicyRow[],
  gateClass: string,
  policyId: string,
  now: number = Date.now()
): EffectiveAuthority {
  return resolveEffectiveAuthority(
    rows.filter((r) => r.policy_id !== policyId),
    gateClass,
    now
  );
}

/**
 * Every class the console should show: the three recommended ones plus any
 * class any row mentions (including inert rows and typos), so a class that
 * matches nothing is VISIBLE rather than silently absent.
 */
export function classesInPlay(rows: readonly CoordPolicyRow[]): string[] {
  const seen = new Set<string>(RECOMMENDED_GATE_CLASSES);
  for (const row of rows) {
    if (!isGateClearanceRow(row)) continue;
    const cls = rawGateClass(row.payload);
    if (cls !== null && cls.length > 0) seen.add(cls);
  }
  return [...seen].sort((a, b) => {
    const ai = (RECOMMENDED_GATE_CLASSES as readonly string[]).indexOf(a);
    const bi = (RECOMMENDED_GATE_CLASSES as readonly string[]).indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b);
  });
}

/**
 * The recommended class `value` *looks* like but is not byte-equal to, or
 * `null`. Case, surrounding whitespace and `_`/`-` confusion are the three ways
 * a class silently matches nothing — coord compares raw strings.
 */
export function nearMissRecommendedClass(value: string): string | null {
  if ((RECOMMENDED_GATE_CLASSES as readonly string[]).includes(value))
    return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  for (const rec of RECOMMENDED_GATE_CLASSES) {
    if (normalized === rec) return rec;
  }
  return null;
}

/** `POST /coord/policies` body for a `gate_clearance` rule (v2 shape). Coord
 *  rejects a `repo` on this domain with a 400, so the field is never sent. */
export interface GateClearanceCreate {
  name: string;
  decision_domain: typeof GATE_CLEARANCE_DOMAIN;
  mode: typeof GATE_CLEARANCE_MODE;
  payload: { gate_class: string; authority: ClearanceAuthority };
  priority?: number;
  rationale?: string;
}

/**
 * `PATCH /coord/policies/:id` body.
 *
 * ⚠️ Coord's `UpdatePolicyRequest` has **no `payload` field** — a PATCH can
 * change a rule's name, priority, enabled flag and rationale, but NOT its
 * class or authority. Changing either requires replacing the row; see
 * `useGateClearanceRules.replaceRule`.
 */
export interface GateClearanceUpdate {
  name?: string;
  priority?: number;
  enabled?: boolean;
  rationale?: string;
}

export function buildCreateBody(input: {
  name: string;
  gateClass: string;
  authority: ClearanceAuthority;
  priority?: number;
  rationale?: string;
}): GateClearanceCreate {
  const body: GateClearanceCreate = {
    name: input.name.trim(),
    decision_domain: GATE_CLEARANCE_DOMAIN,
    mode: GATE_CLEARANCE_MODE,
    payload: { gate_class: input.gateClass, authority: input.authority },
  };
  if (input.priority !== undefined) body.priority = input.priority;
  const rationale = input.rationale?.trim();
  if (rationale) body.rationale = rationale;
  return body;
}
