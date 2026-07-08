/**
 * Policy Documents (agent Q&A meta-answer, Phase 1) — shared types.
 *
 * These mirror the coord `/coord/policy-documents` contract (Rust
 * `src/policy_documents.rs`, `PolicyDocumentRow`). The web backend forwards them
 * verbatim through the tenant coord-proxy
 * (`/api/v1/operations/coord/policy-documents`): reads are visible to any tenant
 * member; writes (PATCH, restore-default) are tenant-admin-gated.
 *
 * A policy document is the editable canonical prose (e.g. Engineering
 * Priorities, Escalation Bar) the decision-delegation meta-answer composes in
 * via `{{policy:<handle>}}` tokens.
 */

/** One `coord.policy_documents` row (coord `PolicyDocumentRow`). */
export interface PolicyDocument {
  id: number;
  tenant_id: string;
  /** Stable slug the meta-answer template references as `{{policy:<handle>}}`. */
  handle: string;
  title: string;
  body: string;
  /** Prose format hint, e.g. `"markdown"`. */
  format: string;
  /**
   * The code constant this row was seeded from (e.g. `policy_doc/<handle>/v1`).
   * `null` for a hand-authored document — the Restore-to-default control is
   * shown only when this is non-null.
   */
  default_source: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** `GET /coord/policy-documents` response. */
export interface ListPolicyDocumentsResponse {
  documents: PolicyDocument[];
  total: number;
}

/** `PATCH /coord/policy-documents/:handle` body. */
export interface PolicyDocumentUpdate {
  title?: string;
  body?: string;
  updated_by?: string;
}
