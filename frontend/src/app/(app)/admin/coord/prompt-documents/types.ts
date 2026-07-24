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
 * store (whose rows migrated in as `kind: "policy"`) to five kinds — one editor
 * for all of them, rather than five unrelated homes.
 *
 * Versioning is the core contract: coord snapshots an immutable version on EVERY
 * edit and bumps `current_version` in the same transaction. Nothing is
 * overwritten in place, so every prior wording stays readable and restorable.
 */

/** The five content families (coord `KINDS`, mirroring the DB CHECK). */
export type PromptDocumentKind =
  | "policy"
  | "response_prompt"
  | "continuation_rules"
  | "agent_playbook"
  | "prompt_template";

/** Every kind, in the order the page renders its groups. */
export const PROMPT_DOCUMENT_KINDS: readonly PromptDocumentKind[] = [
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
  updated_by: string | null;
  updated_at: string;
  /** Free-form attributes (policy docs carry `{ default_tier, description }`). */
  attrs: PromptDocumentAttrs | null;
}

/** A full `coord.prompt_documents` row, body included (the get-one shape). */
export interface PromptDocument extends PromptDocumentSummary {
  tenant_id: string;
  body: string;
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
   * Free-form attributes to merge onto the document (the category header editor
   * writes `{ default_tier }` here). Forwarded verbatim by the PATCH proxy.
   */
  attrs?: PromptDocumentAttrs;
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
