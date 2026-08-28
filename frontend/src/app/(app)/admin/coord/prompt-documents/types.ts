/**
 * Prompt Documents (plan `2026-07-17-session-autonomy-fabric.md` Phase 9) —
 * shared types.
 *
 * These mirror the coord `/coord/prompt-documents` contract (Rust
 * `src/prompt_documents.rs`, `PromptDocumentRow`). The web backend forwards them
 * verbatim through the tenant coord-proxy
 * (`/api/v1/operations/coord/prompt-documents`): reads are visible to any tenant
 * member; writes (PATCH, restore-default) are tenant-admin-gated and carry the
 * editing user, stamped server-side from the web session.
 *
 * A prompt document is any prompt-shaped content coord serves the fleet,
 * addressed by `(kind, name)`. This generalizes the former `policy_documents`
 * store (whose rows migrated in as `kind: "policy"`) to thirteen kinds — one
 * editor for all of them, rather than thirteen unrelated homes.
 *
 * The thirteen split cleanly in two, and the split is the point (plan
 * `2026-08-21-project-intent-documents-and-the-selection-loop`, § "Naming
 * constraint"): **policy = how to act, intent = what to build.** The seven
 * BEHAVIOR kinds are normative — each tells a session how to conduct itself.
 * The six INTENT kinds describe the product the tenant is *building*: what it
 * is for, for whom, and what "better" means. Filing a behavioral rule under an
 * intent kind is the one thing that erodes the design, so the bands below are
 * rendered, not implied — see `KIND_BAND`.
 *
 * Versioning is the core contract: coord snapshots an immutable version on EVERY
 * edit and bumps `current_version` in the same transaction. Nothing is
 * overwritten in place, so every prior wording stays readable and restorable.
 */

/** The thirteen content families (coord `KINDS`, mirroring the DB CHECK). */
export type PromptDocumentKind =
  | "session_briefing"
  // ── intent: what we are building, for whom, and what "better" means ──
  | "product_intent"
  | "initiative"
  | "success_metric"
  | "domain_spec"
  | "audience_profile"
  | "decision_record"
  // ── behavior: how a session must act while building it ──
  | "policy"
  | "response_prompt"
  | "continuation_rules"
  | "agent_playbook"
  | "prompt_template"
  | "claude_settings";

/**
 * Every kind, in the order the page renders its groups — ordered by AUTHORITY,
 * not alphabetically and not by when the kind shipped.
 *
 * This order is preserved WITHIN each band (see `KIND_BAND` / `kindsInBand`),
 * so a kind's position here is what decides where it sits among its band-mates.
 */
export const PROMPT_DOCUMENT_KINDS: readonly PromptDocumentKind[] = [
  // First on purpose: this is the most consequential document in the store —
  // it is appended to the system prompt of every session the runner hosts.
  "session_briefing",

  // The intent layer, most-general first: vision tie-breaks, the cycle-scoped
  // initiative is what actually ranks near-term work, and the rest qualify it.
  "product_intent",
  "initiative",
  "success_metric",
  "domain_spec",
  "audience_profile",
  "decision_record",

  // The remaining behavioral kinds.
  "policy",
  "response_prompt",
  "continuation_rules",
  "agent_playbook",
  "prompt_template",
  // Last of the behavioral run rather than second overall, which is where it
  // landed when it was one of seven kinds: the band split now carries the
  // "an edit here changes what every session on this machine may do" weight
  // that its position used to, and it renders inside Behavior — the band that
  // is rendered FIRST precisely so nothing normative is pushed below an
  // unedited intent skeleton.
  "claude_settings",
] as const;

/**
 * The two halves of the store. Presentational ONLY — a band is a heading, not
 * a permission and not an address: no filter defaults to one, no route names
 * one, and the create dialog offers all thirteen kinds regardless.
 */
export type PromptDocumentBand = "behavior" | "intent";

/**
 * Which band each kind belongs to.
 *
 * **Exhaustive `Record` on purpose.** A kind added to `PromptDocumentKind`
 * without an entry here is a TYPE ERROR, not a bandless group quietly rendered
 * at the bottom of whichever half the code happened to reach first. The
 * alternative — testing the kind name for a substring, or reading a band off a
 * new DB column — would let kind fourteen ship into the wrong half silently,
 * which is the failure this constant exists to make impossible.
 */
export const KIND_BAND: Record<PromptDocumentKind, PromptDocumentBand> = {
  session_briefing: "behavior",
  policy: "behavior",
  response_prompt: "behavior",
  continuation_rules: "behavior",
  agent_playbook: "behavior",
  prompt_template: "behavior",
  claude_settings: "behavior",
  product_intent: "intent",
  initiative: "intent",
  success_metric: "intent",
  domain_spec: "intent",
  audience_profile: "intent",
  decision_record: "intent",
};

/**
 * The bands in render order — **Behavior first**, and that is load-bearing.
 *
 * `session_briefing` is the most consequential document in the store and it
 * lives in Behavior. Rendering Intent first would push it below whatever
 * `product_intent` rows exist — including an unedited shipped skeleton, which
 * is UNKNOWN rather than intent. The band split must not demote the fleet's
 * system prompt beneath a placeholder.
 *
 * That is the same false-signal class the selection loop's step-1 skeleton rule
 * exists to prevent (`current_version === 1 && default_source !== null` ⇒ never
 * edited ⇒ do not rank against it). Fixing it in the ranking and reintroducing
 * it in the layout would be incoherent.
 *
 * **Do not flip this to put Intent first.** It looks like the obvious tidy-up —
 * the nav section is called `Intent ▾`, so Intent-first reads more consistent —
 * and it was considered and rejected on 2026-08-25 by the two sessions that own
 * the two halves (this plan, and
 * `2026-08-25-coord-console-intent-and-devops-sections`, which owns the nav
 * section). The section label was chosen KNOWING it names only half of what the
 * section holds; the honesty comes from the bands being visible and LABELLED,
 * not from their order. The section-level wobble is answered by the page's
 * intro copy, which names both halves — not by reordering these.
 */
export const PROMPT_DOCUMENT_BANDS: readonly PromptDocumentBand[] = [
  "behavior",
  "intent",
] as const;

/**
 * Operator-facing heading per band: the label, and the question the kinds
 * underneath it answer. The question is the whole reason the bands exist —
 * thirteen kind groups in one flat run makes the reader re-derive, per group,
 * which question that kind is for.
 */
export const BAND_META: Record<
  PromptDocumentBand,
  { label: string; question: string }
> = {
  behavior: {
    label: "Behavior",
    question: "how a session must act while building it",
  },
  intent: {
    label: "Intent",
    question: 'what we are building, for whom, and what "better" means',
  },
};

/** The kinds in one band, in `PROMPT_DOCUMENT_KINDS`' authority order. */
export function kindsInBand(
  band: PromptDocumentBand
): readonly PromptDocumentKind[] {
  return PROMPT_DOCUMENT_KINDS.filter((kind) => KIND_BAND[kind] === band);
}

/**
 * The three `session_briefing` names the runner actually resolves — coord
 * `NAME_RUNNER_SESSION` / `NAME_PLAN_CAPTURE_CLAUSE` / `NAME_AI_SESSION_RULES`.
 *
 * Two properties hang off membership, and both cut the same way:
 *
 * 1. **Only these are read.** The runner fetches them by name; it does not LIST
 *    the kind. A fourth row is stored and versioned but inert.
 * 2. **Only these are protected from agent writes.** Coord's
 *    `AGENT_UNWRITABLE_DOCUMENTS` is a list of `(kind, name)` PAIRS, not a
 *    kind-wide deny — so a fourth row is agent-writable by default, exactly
 *    because it is inert.
 *
 * Held as a constant rather than left as prose inside `KIND_META` so the create
 * dialog can actually check the name an operator typed instead of hoping they
 * read the sentence.
 */
export const SESSION_BRIEFING_DOCUMENT_NAMES: readonly string[] = [
  "runner-session",
  "plan-capture-clause",
  "ai-session-rules",
];

/**
 * True for a `session_briefing` row the runner will never read.
 *
 * The membership test itself is one line; what earns it a name is that TWO
 * surfaces have to agree on it and they answer different questions with it.
 * The create dialog asks "is the address the operator is about to take a trap?"
 * — a question about a name being typed. The list asks "is this stored row one
 * of the live three?" — a question about a row that already exists, which is
 * the case the create-time warning cannot reach: a row seeded before that
 * warning shipped, or one an agent created through
 * `coord_write_prompt_document` (coord's `AGENT_UNWRITABLE_DOCUMENTS` covers
 * the three canonical `(kind, name)` pairs, so any OTHER briefing name is
 * agent-writable by default).
 *
 * `name` is trimmed because the create dialog checks a live input value; a
 * stored row's name is already normalized by coord.
 */
export function isInertSessionBriefing(
  kind: PromptDocumentKind,
  name: string
): boolean {
  return (
    kind === "session_briefing" &&
    !SESSION_BRIEFING_DOCUMENT_NAMES.includes(name.trim())
  );
}

/** Operator-facing label + one-line explanation per kind. */
export const KIND_META: Record<
  PromptDocumentKind,
  { label: string; description: string }
> = {
  session_briefing: {
    label: "Session Briefing",
    // The three names are interpolated rather than retyped: this sentence and
    // the create dialog's inert-name check have to agree, and a prose copy is
    // the half that goes stale.
    description: `Appended to the system prompt of every session the runner hosts. The runner reads exactly three names — ${SESSION_BRIEFING_DOCUMENT_NAMES.join(", ")}; any other document under this kind is stored and versioned but inert.`,
  },
  // ───────────────────────────── the intent band ─────────────────────────────
  // Each description leads with the VERB — what a reader DOES with the kind —
  // because this is the only place that verb is written down, and "what the
  // kind is called" tells an operator nothing about when to reach for it. The
  // subject of all six is the product YOU are building, not the tooling.
  product_intent: {
    label: "Product Intent",
    description:
      "Justify a direction, and break ties between work that all looks reasonable: why this product exists, where it ends up, and what it will never be. Too general to rank near-term work on its own — that is what an initiative is for.",
  },
  initiative: {
    label: "Initiative",
    description:
      "Rank near-term work: one time-boxed push, with what is explicitly in and out of scope for this cycle, and the bar new work must clear before it is worth authoring instead of picking something up. With no live initiative there is no bar, and nothing should be authored.",
  },
  success_metric: {
    label: "Success Metric",
    description:
      "Measure whether the product got better: what is counted, where the number comes from, the current baseline, the target, and which direction is good. A goal nobody can count is a preference.",
  },
  domain_spec: {
    label: "Domain Spec",
    description:
      "Diff intent against reality: what a subsystem is SUPPOSED to do, written independently of what it currently does. Every line the implementation fails to match is a candidate piece of work.",
  },
  audience_profile: {
    label: "Audience Profile",
    description:
      "Justify work for whom: who uses this product, what they are trying to get done, and what they will not tolerate — including AI agents where they are consumers of it too.",
  },
  decision_record: {
    label: "Decision Record",
    description:
      "Refuse to re-litigate: a settled choice, why it was made, and explicitly what new evidence would reopen it. Without this a goal-driven session eventually 'fixes' a deliberate design.",
  },
  // ──────────────────────────── the behavior band ────────────────────────────
  claude_settings: {
    label: "Claude Code Settings",
    description:
      "The fleet's Claude Code settings BASELINE — a versioned document a machine copies into its own `.claude/settings.json`, not live configuration. `hooks` are deliberately excluded (a served shell command is remote code execution by configuration) and travel via `scripts/install-guard-hooks.sh`.",
  },
  policy: {
    label: "Policy",
    description:
      "Canonical policy prose. The agent Q&A meta-answer composes these in via {{policy:<name>}} tokens, expanded per tenant at answer time.",
  },
  response_prompt: {
    label: "Response Prompts",
    description:
      "Templates coord answers agent questions with, such as the standing decision-delegation meta-answer.",
  },
  continuation_rules: {
    label: "Continuation Rules",
    description:
      "The umbrella prompt served to a session that is about to stop — what it should consider before finishing.",
  },
  agent_playbook: {
    label: "Agent Playbooks",
    description:
      "Operating playbooks fetched by agent sessions at spawn, such as the merge-shepherd playbook.",
  },
  prompt_template: {
    label: "Prompt Templates",
    description:
      "Curated, parameterized prompts served to runner terminals (the /prompt library).",
  },
};

/**
 * Free-form per-document attributes (JSONB `coord.prompt_documents.attrs`). For a
 * `policy` document this carries the structured-clause metadata the clause editor
 * writes — chiefly the per-category `default_tier` inherited by clauses that
 * don't pin their own tier. `null` when the document has no attrs.
 */
export interface PromptDocumentAttrs {
  /** The tier clauses inherit when their own `tier` is null (see `ClauseTier`). */
  default_tier?: ClauseTier | null;
  /** Optional prose description mirrored into attrs by the category editor. */
  description?: string | null;
  [key: string]: unknown;
}

/** One `coord.prompt_documents` row WITHOUT its body (the list shape). */
export interface PromptDocumentSummary {
  id: string;
  kind: PromptDocumentKind;
  /** Stable slug; the address half of `(kind, name)`. */
  name: string;
  description: string | null;
  /** Prose format hint, e.g. `"markdown"`. */
  format: string;
  /**
   * The code constant this row was seeded from (e.g.
   * `prompt_doc/<kind>/<name>/v1`). `null` for a hand-authored document — the
   * Restore-to-default control is shown only when this is non-null.
   */
  default_source: string | null;
  /** Monotonic; bumped by coord on every edit. */
  current_version: number;
  /**
   * The operator's per-document agent-write setting, RAW.
   *
   * Three states, and they are not two: `true` = the operator opened this
   * document, `false` = the operator protected it, **`null` = the operator has
   * never ruled on it**, which falls back to coord's compile-time default.
   *
   * Never render `null` as an unchecked box or as "open". "Unset" and
   * "explicitly open" have the same effect today and are different facts — the
   * first tracks a later change to coord's default, the second overrides it
   * permanently. Use `agent_write_source` to tell them apart.
   */
  agent_writable?: boolean | null;
  /**
   * The resolved answer coord will actually enforce.
   *
   * **Optional on purpose.** A coord that predates this feature omits it
   * entirely, which is a real window: the migration and this UI land before /
   * around the coord deploy that starts returning it. An absent value is
   * UNKNOWN, not `false` — rendering it as "protected" would tell an operator
   * their whole corpus is locked down when coord is in fact still allowing
   * ordinary writes, which is the more dangerous of the two wrong answers.
   */
  agent_write_effective?: boolean;
  /**
   * Where `agent_write_effective` came from: `"operator"` when this document
   * carries an explicit setting, `"default"` when coord's built-in protection
   * rule decided.
   *
   * Computed server-side ON PURPOSE. Deriving it here would mean shipping a
   * second copy of coord's `AGENT_UNWRITABLE_DOCUMENTS` list into the browser,
   * and the day a protected document is added in Rust this page would label it
   * "open (default)" while coord denied every write to it. That is not
   * hypothetical: the list grew from three rows to six when the session
   * briefings were added, and this page needed no change precisely because it
   * derives nothing.
   */
  agent_write_source?: "operator" | "default";
  /**
   * What coord's built-in rule says, IGNORING any operator override — `false`
   * exactly for a document on coord's `AGENT_UNWRITABLE_DOCUMENTS` list.
   *
   * That list holds TWO families, protected for different reasons: the
   * meta-policies (`kind: "policy"`), which define how every other document is
   * classified and applied; and the three canonical session briefings
   * (`kind: "session_briefing"`, see `SESSION_BRIEFING_DOCUMENT_NAMES`), which
   * are pushed into every session's system prompt. The distinction does not
   * change this field's meaning, but it does change what the operator must be
   * told when overriding it — see `AgentWriteAccessControl`.
   *
   * This is NOT derivable from `agent_write_source`. Once an operator touches a
   * document at all, `source` becomes `"operator"` permanently, so a
   * confirmation keyed on `source === "default"` would fire the first time a
   * meta-policy was opened and never again: open, protect, and the third click
   * re-opens it silently. Whether a document is one the code protects does not
   * change when the row is written, and only this field says so.
   */
  agent_write_builtin_default?: boolean;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Coord's three-state agent authorship TIER — the vocabulary stored in
 * `coord.prompt_documents.agent_write_tier` and
 * `coord.prompt_document_kind_tiers.tier`.
 *
 * These strings are a WIRE contract with coord's `AgentWriteTier::as_str`, not
 * display labels: coord's DB CHECK constrains the column to exactly these, and
 * a value outside the set resolves fail-closed to `deny` on the enforcement
 * path. Renaming one here does not rename it there — it just stops matching.
 *
 * ⚠️ `allow_with_notification` currently BEHAVES as `allow`. Coord resolves the
 * tier but does not yet enforce the notification precondition (Phase 2 of plan
 * `2026-08-27-tenant-level-agent-authorable-stores`), which is why every
 * kind-tier response carries `notification_enforced` and a prose `warning`
 * saying so. Do not render this tier's NAME without that disclosure.
 */
export type AgentWriteTier = "deny" | "allow" | "allow_with_notification";

/** Every tier, least permissive first — matches coord's `AgentWriteTier::ALL`. */
export const AGENT_WRITE_TIERS: readonly AgentWriteTier[] = [
  "deny",
  "allow",
  "allow_with_notification",
] as const;

/** Narrow an arbitrary coord string to a tier this console knows. */
export function isAgentWriteTier(value: unknown): value is AgentWriteTier {
  return (
    typeof value === "string" &&
    (AGENT_WRITE_TIERS as readonly string[]).includes(value)
  );
}

/** A full `coord.prompt_documents` row, body included (the get-one shape). */
export interface PromptDocument extends PromptDocumentSummary {
  tenant_id: string;
  body: string;
  /**
   * Free-form attributes (policy docs carry `{ default_tier, description }`).
   * Only the get-one shape carries this — coord's list summaries never return
   * `attrs`, so it deliberately lives here rather than on
   * `PromptDocumentSummary`.
   */
  attrs: PromptDocumentAttrs | null;
}

/**
 * `GET /coord/prompt-documents` response.
 *
 * `degraded` is coord's honest note that the document store is not provisioned
 * in its database yet (the deploy-ordering window where coord is live ahead of
 * the migration). Present ⇒ the empty list means "cannot see", NOT "nothing is
 * there", and the page says so rather than rendering a confident empty state.
 */
export interface ListPromptDocumentsResponse {
  documents: PromptDocumentSummary[];
  total: number;
  degraded?: string;
}

/** `POST /coord/prompt-documents/:kind` body — create a new hand-authored document. */
export interface PromptDocumentCreate {
  /** Kebab-case slug; the address half of `(kind, name)`. Coord 400s a bad slug. */
  name: string;
  description?: string;
  body: string;
  /** Prose format hint; defaults to `"markdown"` server-side when omitted. */
  format?: string;
}

/** `PATCH /coord/prompt-documents/:kind/:name` body. */
export interface PromptDocumentUpdate {
  description?: string;
  body?: string;
  /** Change note recorded on the version snapshot (not the doc description). */
  change_description?: string;
  /**
   * The complete replacement attrs object (the category header editor merges
   * `document.attrs` client-side before setting `default_tier`). Forwarded
   * verbatim by the PATCH proxy; the server replaces stored attrs wholesale.
   */
  attrs?: PromptDocumentAttrs;
  /**
   * Set this document's per-document agent write access. `true` opens it,
   * `false` protects it; omit to leave it alone.
   *
   * There is deliberately no way to clear it back to `null` (re-inherit the
   * default) over the wire — coord has no encoding for it either. Unlike every
   * other field here, setting this creates a VERSION: it is authority, and who
   * changed it has to survive the next agent append.
   */
  agent_writable?: boolean;
}

/* ------------------------------------------------------------------------- *
 * Structured policy clauses (plan
 * `2026-07-18-policy-clause-schema-web-data-model.md`, Phase 2).
 *
 * A `policy` prompt document can be edited as an ordered list of structured
 * clauses (`coord.policy_clauses`) in addition to its prose body. These mirror
 * the coord clause-route contract under
 * `/coord/prompt-documents/:kind/:name/clauses`.
 * ------------------------------------------------------------------------- */

/** Lifecycle state of a clause (matches `coord.policy_clauses.status`). */
export type ClauseStatus =
  | "gap"
  | "proposed"
  | "confirmed"
  | "active"
  | "retired";

export const CLAUSE_STATUSES: readonly ClauseStatus[] = [
  "gap",
  "proposed",
  "confirmed",
  "active",
  "retired",
] as const;

/** Badge variant per status (see `@/components/ui/badge`). */
export const CLAUSE_STATUS_VARIANT: Record<
  ClauseStatus,
  "default" | "secondary" | "outline" | "success" | "warning" | "info"
> = {
  gap: "outline",
  proposed: "warning",
  confirmed: "info",
  active: "success",
  retired: "secondary",
};

/**
 * Autonomy tier of a clause (matches `coord.policy_clauses.tier`). `null` means
 * "inherit" — the clause takes the category's `attrs.default_tier`.
 */
export type ClauseTier =
  | "proceed"
  | "proceed+log"
  | "proceed+notify"
  | "ask-first"
  | "never";

export const CLAUSE_TIERS: readonly ClauseTier[] = [
  "proceed",
  "proceed+log",
  "proceed+notify",
  "ask-first",
  "never",
] as const;

/** The sentinel the tier `<Select>` uses for the null/"inherit" choice. */
export const TIER_INHERIT = "__inherit__";

/**
 * Plain-language descriptions of each autonomy tier, for non-technical
 * operators. Surfaced as helper text under the tier selectors so the selected
 * `proceed+notify`-style token is always paired with an explanation of what it
 * means for how agents behave.
 */
export const TIER_DESCRIPTIONS: Record<ClauseTier, string> = {
  proceed: "Agents act on their own.",
  "proceed+log": "Agents act on their own, and record what they did.",
  "proceed+notify": "Agents act on their own, then tell you.",
  "ask-first": "Agents check with you first, and act only once you approve.",
  never: "Agents never do this — it's left entirely to you.",
};

/** One `coord.policy_clauses` row. */
export interface Clause {
  clause_id: string;
  category: string;
  status: ClauseStatus;
  /** `null` ⇒ inherit the category default tier. */
  tier: ClauseTier | null;
  trigger: string;
  action: string;
  bounds: string;
  escalate_if: string;
  anti_triggers: string[];
  depends_on: string[];
  links: string[];
  position: number;
  source: Record<string, unknown> | null;
}

/** `POST …/clauses` body — the full clause shape sans server-managed fields. */
export interface ClauseCreate {
  clause_id: string;
  category: string;
  status: ClauseStatus;
  tier: ClauseTier | null;
  trigger: string;
  action: string;
  bounds: string;
  escalate_if: string;
  anti_triggers: string[];
  depends_on: string[];
  links: string[];
}

/** `PATCH …/clauses/:clause_id` body — every field optional. */
export type ClauseUpdate = Partial<Omit<ClauseCreate, "clause_id">>;

/** `GET …/clauses` response — coord returns the ordered array (or `{clauses}`). */
export type ListClausesResponse = Clause[] | { clauses: Clause[] };

/** One version row WITHOUT its body (the history-list shape). */
export interface PromptDocumentVersionMeta {
  id: string;
  version_number: number;
  /** The change note recorded at edit time. */
  description: string | null;
  edited_by: string | null;
  created_at: string;
}

/** One immutable version snapshot, body included. */
export interface PromptDocumentVersion extends PromptDocumentVersionMeta {
  document_id: string;
  body: string;
}

/** `GET /coord/prompt-documents/:kind/:name/versions` response. */
export interface ListVersionsResponse {
  document_id: string;
  kind: PromptDocumentKind;
  name: string;
  current_version: number;
  versions: PromptDocumentVersionMeta[];
  total: number;
}

// ────────────────────── policy-write autonomy dial ──────────────────────

/**
 * The `fleet_runtime_policy` domain governing how much of the agent
 * policy-write surface this tenant permits.
 *
 * Plan `2026-08-06-agent-policy-replace-and-write-autonomy-dial` §4. Mirrors
 * coord's `fleet_policy::POLICY_WRITE_DOMAIN`.
 */
export const POLICY_WRITE_DOMAIN = "policy_write";

/**
 * The levels, most restrictive first. A total order — each strictly contains
 * the previous. Mirrors coord's `PolicyWriteLevel::ALL`.
 */
export const POLICY_WRITE_LEVELS = [
  "off",
  "propose_only",
  "tightening_only",
  "full",
] as const;
export type PolicyWriteLevel = (typeof POLICY_WRITE_LEVELS)[number];

/**
 * What coord applies when NO row matches — deliberately NOT the resolver's bare
 * `"off"`.
 *
 * `resolve_effective` answers `off` for both "nobody wrote a row" and "an
 * operator turned it off". Taking the first literally would disable, fleet-wide
 * and on deploy, a capability that works today. `tightening_only` is exactly
 * coord's shipped behaviour, so a tenant that never touches the dial sees no
 * change. Mirrors coord's `POLICY_WRITE_DEFAULT`.
 */
export const POLICY_WRITE_DEFAULT_LEVEL: PolicyWriteLevel = "tightening_only";

/**
 * Whether a string coord returned is a level this console can interpret.
 *
 * Nothing validates `level` anywhere on the way in — coord's PUT takes it as
 * free text by design ("a new domain and its levels are data, not schema") and a
 * row can be written by hand — so a typo like `tightening-only` reaches the
 * read path verbatim. Coord's ENFORCEMENT path already handles that:
 * `PolicyWriteLevel::parse_fail_closed` resolves an unrecognized level to `off`,
 * the most restrictive level, because "an unreadable authority setting is not
 * permission".
 *
 * The generic `GET /coord/fleet-policy` does NOT run that parse — it is
 * domain-agnostic and answers with the raw stored string. So a console that
 * renders `effective_level` unconditionally shows a typo'd row as the level in
 * force while agents are in fact being refused outright, which is the widest
 * possible gap between what the operator reads and what the fleet does.
 */
export function isPolicyWriteLevel(value: string): value is PolicyWriteLevel {
  return (POLICY_WRITE_LEVELS as readonly string[]).includes(value);
}

/**
 * What coord ENFORCES for a level it cannot parse — the most restrictive one,
 * not [`POLICY_WRITE_DEFAULT_LEVEL`].
 *
 * The asymmetry is coord's and is deliberate: *no row* means nobody expressed an
 * opinion, so today's shipped behaviour applies; an *unparseable row* means
 * somebody expressed an opinion coord cannot read, which is a different and more
 * alarming fact. Mirrors `PolicyWriteLevel::parse_fail_closed`.
 */
export const POLICY_WRITE_FAIL_CLOSED_LEVEL: PolicyWriteLevel = "off";

/**
 * Levels an operator may select.
 *
 * **`full` became selectable when coord retired its clamp** (`7708317c`,
 * 2026-08-23). It was withheld for as long as `full`'s only safety property —
 * that the operator is told after a loosening lands — was unbacked: the
 * notification substrate had shipped but nothing emitted
 * `NotificationKind::PolicyDocumentChanged`, so
 * `FULL_REQUIRES_POLICY_CHANGE_EMITTER` clamped `full` to `tightening_only` on
 * every enforcement read. The emitter landed (coord#1517 + restack #1542) and,
 * crucially, coord pinned the property rather than inspecting it once:
 * `every_committing_version_bump_emits` fails if any committing version bump
 * loses its emit again. Hiding `full` after that stopped describing a
 * restriction and started being one, imposed by a console with no authority to
 * impose it.
 *
 * **This list is deliberately NOT derived from coord's flag**, which is not on
 * the wire. If the clamp is ever re-armed, an operator selecting `full` gets the
 * honest answer from the mechanism that already exists for it: the write lands,
 * the read-back reports `tightening_only`, and the control says devices resolve
 * something other than what was written. A console that guessed at the flag
 * could be wrong in the other direction — hiding a level that works.
 */
export const POLICY_WRITE_SELECTABLE_LEVELS: readonly PolicyWriteLevel[] = [
  "off",
  "propose_only",
  "tightening_only",
  "full",
];

/**
 * Levels whose selection is confirmed before it is written.
 *
 * `full` is the only level at which an agent may land a change the operator
 * never reviewed. Every other level either refuses the write or queues it as a
 * proposal, so selecting them cannot widen anything by accident.
 *
 * The page already holds this convention: `AgentWriteAccessControl` confirms
 * overriding a built-in protection because "a control that made it one click
 * would make the fleet's most consequential setting its least deliberate". The
 * same sentence applies here, and the two controls sit inches apart.
 */
export const POLICY_WRITE_CONFIRMED_LEVELS: readonly PolicyWriteLevel[] = [
  "full",
];

/** One-line description per level, for the control's help text. */
export const POLICY_WRITE_LEVEL_HELP: Record<PolicyWriteLevel, string> = {
  off: "No agent policy writes at all — every operation is refused, including appending a new clause.",
  propose_only:
    "Agents write nothing directly; every operation becomes a pending proposal for you to approve.",
  tightening_only:
    "Agents may land a provable tightening or no-op; anything else becomes a pending proposal. This is coord's built-in default.",
  full: "Agents may also land a classified loosening directly, with a notification afterwards instead of a proposal to approve. The only level at which a policy change reaches the fleet without your review.",
};
