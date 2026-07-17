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
 * store (whose rows migrated in as `kind: "policy"`) to four kinds — one editor
 * for all of them, rather than four unrelated homes.
 *
 * Versioning is the core contract: coord snapshots an immutable version on EVERY
 * edit and bumps `current_version` in the same transaction. Nothing is
 * overwritten in place, so every prior wording stays readable and restorable.
 */

/** The four content families (coord `KINDS`, mirroring the DB CHECK). */
export type PromptDocumentKind =
  | "policy"
  | "response_prompt"
  | "continuation_rules"
  | "agent_playbook";

/** Every kind, in the order the page renders its groups. */
export const PROMPT_DOCUMENT_KINDS: readonly PromptDocumentKind[] = [
  "policy",
  "response_prompt",
  "continuation_rules",
  "agent_playbook",
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
};

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

/** `PATCH /coord/prompt-documents/:kind/:name` body. */
export interface PromptDocumentUpdate {
  description?: string;
  body?: string;
  /** Change note recorded on the version snapshot (not the doc description). */
  change_description?: string;
}

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
