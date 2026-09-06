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
 * authors v2 rows through `_shared/useCoordPolicies` +
 * `_shared/coordPolicyApi`. This is that surface for a different domain
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
 * `crates/coord/src/policies/next_step_settings.rs:34-74`, the façade behind
 * `GET/PUT /coord/next-step-settings`, whose `is_known_domain` (`:115`) is the
 * server-side membership test for exactly these five. They share the property
 * that makes them safe to author here: each one produces a GUIDANCE FRAME for
 * an agent deciding a next step, and none of them grants an authority. A row
 * in any other domain is not listed and not creatable on this page; that is a
 * deliberate, reviewable edit to [`DECISION_POLICY_DOMAINS`], not an omission.
 *
 * ## Creating a row arms NOTHING, and the UI has to say so
 *
 * Coord's `CreatePolicyRequest` has no `autonomy_level` field at all
 * (`policies/routes.rs:279-294` records why — coord#920 makes graduation an
 * explicit, auditable PATCH boundary), so every created row lands at the
 * column default `always_escalate`, which `policies/decide.rs:533-537`
 * short-circuits to `Escalate` **regardless of mode**. Creating a row
 * therefore changes exactly one observable thing: the durable hold marker
 * moves from `escalated_no_policy` to `escalated_by_policy`. See
 * [`CREATE_IS_INERT`].
 */

import type { CoordPolicyRow } from "../_shared/coordPolicies";

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
   * `next_step_settings::effective` also requires the platform master flag
   * before the domain acts.
   */
  requiresMaster: boolean;
}

/**
 * The five domains this page authors — coord's `DOMAIN_SPECS`, in coord's own
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
  },
  {
    domain: "pr_fix",
    label: "Automatic fixer for stuck PRs",
    description:
      "Coordination may dispatch (auto_decide) or frame (guidance_only) a fixer agent when one of your PRs is detected stuck in review or CI.",
    canonicalMode: "guidance",
    requiresMaster: true,
  },
  {
    domain: "red_main_fix",
    label: "Automatic fixer for code-class red main",
    description:
      "Coordination may dispatch (auto_decide) or frame (guidance_only) a fixer agent when a repo's main goes red for a code reason — a tenant-wide merge outage with no owning PR-author session.",
    canonicalMode: "guidance",
    requiresMaster: true,
  },
  {
    domain: "architecture_tradeoff",
    label: "Architecture trade-offs",
    description: "How design trade-offs are decided.",
    canonicalMode: "guidance",
    requiresMaster: false,
  },
  {
    domain: "verification_sufficiency",
    label: "Verification sufficiency",
    description: "When evidence is enough to call work done.",
    canonicalMode: "guidance",
    requiresMaster: false,
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
  "always_escalate — which coord short-circuits to Escalate regardless of mode. Consults for this domain " +
  "still escalate to you; the only thing that changes is the hold marker, from escalated_no_policy to " +
  "escalated_by_policy. Graduating the row is a separate, deliberate step on the row itself.";

/** Why `auto_decide` may still not act, for the three master-gated domains. */
export const MASTER_FLAG_CAVEAT =
  "auto_decide is necessary but not sufficient for this domain: coord also requires the platform master " +
  "flag (and, for the fixer domains, its own dispatch env flag). Graduating here does not arm those.";

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
  const repo = input.repo?.trim();
  if (repo) body.repo = repo;
  if (input.priority !== undefined) body.priority = input.priority;
  const rationale = input.rationale?.trim();
  if (rationale) body.rationale = rationale;
  return body;
}
