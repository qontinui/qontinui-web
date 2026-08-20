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
 * store (whose rows migrated in as `kind: "policy"`) to six kinds — one editor
 * for all of them, rather than six unrelated homes.
 *
 * Versioning is the core contract: coord snapshots an immutable version on EVERY
 * edit and bumps `current_version` in the same transaction. Nothing is
 * overwritten in place, so every prior wording stays readable and restorable.
 */

/** The six content families (coord `KINDS`, mirroring the DB CHECK). */
export type PromptDocumentKind =
  | "session_briefing"
  | "policy"
  | "response_prompt"
  | "continuation_rules"
  | "agent_playbook"
  | "prompt_template";

/** Every kind, in the order the page renders its groups. */
export const PROMPT_DOCUMENT_KINDS: readonly PromptDocumentKind[] = [
  // First on purpose: this is the most consequential document in the store —
  // it is appended to the system prompt of every session the runner hosts.
  "session_briefing",
  "policy",
  "response_prompt",
  "continuation_rules",
  "agent_playbook",
  "prompt_template",
] as const;

/** Operator-facing label + one-line explanation per kind. */
export const KIND_META: Record<
  PromptDocumentKind,
  { label: string; description: string }
> = {
  session_briefing: {
    label: "Session Briefing",
    description:
      "Appended to the system prompt of every session the runner hosts. The runner reads exactly three names — runner-session, plan-capture-clause and ai-session-rules; any other document under this kind is stored and versioned but inert.",
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
   * carries an explicit setting, `"default"` when coord's built-in meta-policy
   * rule decided.
   *
   * Computed server-side ON PURPOSE. Deriving it here would mean shipping a
   * second copy of coord's `AGENT_UNWRITABLE_DOCUMENTS` list into the browser,
   * and the day a fourth meta-policy is added in Rust this page would label it
   * "open (default)" while coord denied every write to it.
   */
  agent_write_source?: "operator" | "default";
  /**
   * What coord's built-in rule says, IGNORING any operator override — `false`
   * exactly for a meta-policy.
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
 * Levels an operator may currently select.
 *
 * `full` is absent, and that is a shipping decision rather than an oversight:
 * its entire safety story is that the operator is notified after a loosening
 * lands, and nothing emits that notification yet (the notification substrate
 * landed; the policy-change emitter did not). Coord clamps `full` to
 * `tightening_only` server-side regardless of what this list says —
 * `FULL_REQUIRES_POLICY_CHANGE_EMITTER` — so hiding it here is the honest
 * presentation of a restriction that is really enforced, not the enforcement
 * itself.
 */
export const POLICY_WRITE_SELECTABLE_LEVELS: readonly PolicyWriteLevel[] = [
  "off",
  "propose_only",
  "tightening_only",
];

/** One-line description per level, for the control's help text. */
export const POLICY_WRITE_LEVEL_HELP: Record<PolicyWriteLevel, string> = {
  off: "No agent policy writes at all — every operation is refused, including appending a new clause.",
  propose_only:
    "Agents write nothing directly; every operation becomes a pending proposal for you to approve.",
  tightening_only:
    "Agents may land a provable tightening or no-op; anything else becomes a pending proposal. This is coord's built-in default.",
  full: "Agents may also land a classified loosening, with a notification instead of a proposal. Not selectable until policy-change notifications ship.",
};
