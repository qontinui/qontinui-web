/**
 * `/operations/coord` prompt-document routes: the documents themselves (list,
 * get, versions, create, edit, restore, withdraw), their structured clauses,
 * cross-tenant publication (publish, publications, the upstream
 * adopt/keep/merge decisions, publish-all and the auto-publish status), the
 * per-kind agent authorship tiers, the policy-edit proposal queue and the
 * landed-write feed, and session-compliance enforcement.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7 batch 4). Every function calls `httpClient.fetch` on
 * the RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline, states
 * its retry policy, and returns the PARSED body through `readJson`. A non-2xx
 * rejects with `<METHOD> <url> failed: <status> - <body>` — the message the
 * `httpClient.get` / `post` / `put` / `patch` / `delete` helpers threw before
 * this module existed, which the callers' refusal classifiers
 * (`classifyPublishError`, `classifyUpstreamDecisionError`,
 * `classifyPublishModeError`, `isQueryRefusal`, `httpStatusOf`) read.
 *
 * Every handler named below lives in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. The wire types are the
 * hand-written ones the prompt-document pages already own (`types.ts`,
 * `compliance-types.ts`, `prompt-document-proposals/types.ts`), except the
 * kind-tier view, which lives here because no other module owned it.
 *
 * Writes whose result no caller reads resolve `null` for a 2xx whose body does
 * not parse (a 204 included): the 2xx is the fact that the change landed, and
 * failing it would invite a repeat of a write that already happened. Writes
 * whose body a caller DOES read keep the strict parse.
 *
 * Retry policy: every `POST` / `PATCH` here is `idempotent: false` — a 5xx is
 * never re-sent, because a gateway timeout can arrive after coord committed
 * (a second version, a second publication, a second decision). The one
 * exception is {@link updatePromptDocumentAttrs}: an attrs-only edit replaces
 * the attrs object in place and cuts no version, so a repeat changes nothing.
 * `GET` / `PUT` / `DELETE` are idempotent by method.
 */

import { httpClient } from "@/services/service-factory";
import type {
  AgentWriteTier,
  AutoPublishStatusResponse,
  ClauseCreate,
  ClauseMergeApplyRequest,
  ClauseMergeApplyResponse,
  ClauseMergePreview,
  ClauseUpdate,
  ListClausesResponse,
  ListPromptDocumentsResponse,
  ListPublicationsResponse,
  ListVersionsResponse,
  PromptDocument,
  PromptDocumentAttrs,
  PromptDocumentCreate,
  PromptDocumentKind,
  PromptDocumentUpdate,
  PromptDocumentVersion,
  Publication,
  PublishAllArmedResponse,
  PublishAllDryRunResponse,
  PublishAllItem,
  PublishRequest,
  PublishResponse,
  UpstreamDecisionRequest,
  UpstreamDecisionResponse,
} from "@/app/(app)/admin/coord/prompt-documents/types";
import type {
  ListComplianceSessionsResponse,
  ListConfigVersionsResponse,
  ListOutstandingResponse,
  SessionComplianceConfig,
  SessionComplianceConfigUpdate,
} from "@/app/(app)/admin/coord/prompt-documents/compliance-types";
import type {
  ListPolicyProposalsResponse,
  ListWritesResponse,
} from "@/app/(app)/admin/coord/prompt-document-proposals/types";
import { OPERATIONS_BASE, readJson } from "./base";

// ─────────────────────────────── documents ───────────────────────────────

/** `GET /coord/prompt-documents` — `list_prompt_documents` (bodies omitted). */
export async function listPromptDocuments(): Promise<ListPromptDocumentsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPromptDocumentsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-documents/{kind}/{name}` — `get_prompt_document`, body included. */
export async function fetchPromptDocument(
  kind: PromptDocumentKind,
  name: string
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PromptDocument>(res, `GET ${url}`);
}

/**
 * `GET /coord/prompt-documents/{kind}/{name}/versions` —
 * `list_prompt_document_versions`: version metadata plus the LIVE
 * `current_version`, which the review feed's undo/withdraw guards re-read.
 */
export async function listPromptDocumentVersions(
  kind: PromptDocumentKind | string,
  name: string
): Promise<ListVersionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/versions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListVersionsResponse>(res, `GET ${url}`);
}

/**
 * `GET /coord/prompt-documents/{kind}/{name}/versions/{version}` —
 * `get_prompt_document_version`: one immutable snapshot, body included.
 */
export async function fetchPromptDocumentVersion(
  kind: PromptDocumentKind | string,
  name: string,
  version: number
): Promise<PromptDocumentVersion> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/versions/${version}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PromptDocumentVersion>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/{kind}` — `create_prompt_document`. Coord
 * writes the row and its v1 snapshot; a duplicate `(kind, name)` is its 409.
 */
export async function createPromptDocument(
  kind: PromptDocumentKind,
  data: PromptDocumentCreate
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(data),
    idempotent: false,
  });
  return readJson<PromptDocument>(res, `POST ${url}`);
}

/**
 * `PATCH /coord/prompt-documents/{kind}/{name}` — `update_prompt_document`.
 * A body or tier edit cuts a NEW version, so a 5xx is never re-sent.
 */
export async function updatePromptDocument(
  kind: PromptDocumentKind | string,
  name: string,
  data: PromptDocumentUpdate
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(data),
    idempotent: false,
  });
  return readJson<PromptDocument>(res, `PATCH ${url}`);
}

/**
 * `PATCH /coord/prompt-documents/{kind}/{name}` with `{attrs}` only — the
 * category header editor's `default_tier`. Safe to re-issue
 * (`idempotent: true`): `update_prompt_document` replaces attrs in place with
 * the client-merged object, and an attrs-only edit creates no version row.
 */
export async function updatePromptDocumentAttrs(
  kind: PromptDocumentKind,
  name: string,
  attrs: PromptDocumentAttrs
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ attrs }),
    idempotent: true,
  });
  return readJson<unknown>(res, `PATCH ${url}`, { unparseable: "null" });
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/restore-default` —
 * `restore_prompt_document_default`: re-seed from the shipped code default, as
 * a new version.
 */
export async function restorePromptDocumentDefault(
  kind: PromptDocumentKind,
  name: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/restore-default`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/versions/{version}/restore` —
 * `restore_prompt_document_version`: copy an earlier snapshot forward as a new
 * version. `change_note` is sent only when given.
 */
export async function restorePromptDocumentVersion(
  kind: PromptDocumentKind,
  name: string,
  version: number,
  changeNote?: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/versions/${version}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(changeNote ? { change_note: changeNote } : {}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/withdraw` —
 * `withdraw_prompt_document`: mark a created decision record withdrawn, as a
 * new version. The withdrawer is stamped by coord, never sent.
 */
export async function withdrawPromptDocument(
  kind: PromptDocumentKind | string,
  name: string,
  reason: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/withdraw`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ reason }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

// ──────────────────────────────── clauses ────────────────────────────────

/**
 * `GET /coord/prompt-documents/{kind}/{name}/clauses` —
 * `list_prompt_document_clauses` (coord answers the array or `{clauses}`).
 */
export async function listPromptDocumentClauses(
  kind: PromptDocumentKind,
  name: string
): Promise<ListClausesResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListClausesResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/clauses` —
 * `create_prompt_document_clause`. A duplicate `clause_id` is coord's 409.
 */
export async function createPromptDocumentClause(
  kind: PromptDocumentKind,
  name: string,
  clause: ClauseCreate
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(clause),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `PATCH /coord/prompt-documents/{kind}/{name}/clauses/{clause_id}` —
 * `update_prompt_document_clause`.
 */
export async function updatePromptDocumentClause(
  kind: PromptDocumentKind,
  name: string,
  clauseId: string,
  patch: ClauseUpdate
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/${encodeURIComponent(clauseId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(patch),
    idempotent: false,
  });
  return readJson<unknown>(res, `PATCH ${url}`, { unparseable: "null" });
}

/**
 * `DELETE /coord/prompt-documents/{kind}/{name}/clauses/{clause_id}` —
 * `delete_prompt_document_clause`.
 */
export async function deletePromptDocumentClause(
  kind: PromptDocumentKind,
  name: string,
  clauseId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/${encodeURIComponent(clauseId)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/clauses/reorder` —
 * `reorder_prompt_document_clauses`: persist a new order of clause ids.
 */
export async function reorderPromptDocumentClauses(
  kind: PromptDocumentKind,
  name: string,
  clauseIds: string[]
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/reorder`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ clause_ids: clauseIds }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

// ────────────────────────────── publication ──────────────────────────────

/**
 * `POST /coord/prompt-documents/{kind}/{name}/publish` —
 * `publish_prompt_document`: promote the current body into the next
 * publication, guarded by `expected_version`.
 */
export async function publishPromptDocument(
  kind: PromptDocumentKind,
  name: string,
  request: PublishRequest
): Promise<PublishResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/publish`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<PublishResponse>(res, `POST ${url}`);
}

/**
 * `GET /coord/prompt-document-publications?kind=&name=` —
 * `list_prompt_document_publications` (body-less summaries).
 */
export async function listPromptDocumentPublications(
  kind: PromptDocumentKind,
  name: string
): Promise<ListPublicationsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-publications?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPublicationsResponse>(res, `GET ${url}`);
}

/**
 * `GET /coord/prompt-document-publications/{kind}/{name}/{version}` —
 * `get_prompt_document_publication`, body included.
 */
export async function fetchPromptDocumentPublication(
  kind: PromptDocumentKind,
  name: string,
  version: number
): Promise<Publication> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-publications/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/${version}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<Publication>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/upstream-adopt` —
 * `adopt_upstream_prompt_document`: replace the body with the publication.
 */
export async function adoptUpstreamPublication(
  kind: PromptDocumentKind,
  name: string,
  decision: UpstreamDecisionRequest
): Promise<UpstreamDecisionResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-adopt`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(decision),
    idempotent: false,
  });
  return readJson<UpstreamDecisionResponse>(res, `POST ${url}`);
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/upstream-keep` —
 * `keep_local_prompt_document`: record the publication as reviewed and
 * declined; the body does not change.
 */
export async function keepLocalOverPublication(
  kind: PromptDocumentKind,
  name: string,
  decision: UpstreamDecisionRequest
): Promise<UpstreamDecisionResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-keep`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(decision),
    idempotent: false,
  });
  return readJson<UpstreamDecisionResponse>(res, `POST ${url}`);
}

/**
 * `GET /coord/prompt-documents/{kind}/{name}/upstream-merge?publication_version=`
 * — `preview_upstream_merge`: the clause-grained merge preview. Read-only.
 */
export async function previewUpstreamMerge(
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number
): Promise<ClauseMergePreview> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-merge?publication_version=${publicationVersion}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ClauseMergePreview>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/{kind}/{name}/upstream-merge` —
 * `apply_upstream_merge`: land a reviewed clause-grained merge.
 */
export async function applyUpstreamMerge(
  kind: PromptDocumentKind,
  name: string,
  request: ClauseMergeApplyRequest
): Promise<ClauseMergeApplyResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-merge`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<ClauseMergeApplyResponse>(res, `POST ${url}`);
}

/**
 * `POST /coord/prompt-documents/publish-all` with `{dry_run: true}` —
 * `publish_all_prompt_documents`'s preview: every candidate with the version it
 * would publish. Writes nothing.
 */
export async function previewPublishAll(): Promise<PublishAllDryRunResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/publish-all`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ dry_run: true }),
    idempotent: false,
  });
  return readJson<PublishAllDryRunResponse>(res, `POST ${url}`);
}

/**
 * `POST /coord/prompt-documents/publish-all` ARMED — publish every item at the
 * version its dry run carried.
 *
 * `dry_run: false` is written here, never left to the caller: on publish-all
 * `dry_run` defaults to TRUE server-side, so omitting it would take another
 * preview and report it as a publication.
 */
export async function publishAllPromptDocuments(
  releaseNote: string | null,
  items: PublishAllItem[]
): Promise<PublishAllArmedResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/publish-all`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      dry_run: false,
      release_note: releaseNote,
      items,
    }),
    idempotent: false,
  });
  return readJson<PublishAllArmedResponse>(res, `POST ${url}`);
}

/**
 * `GET /coord/prompt-documents/auto-publish/status` —
 * `get_prompt_document_auto_publish_status`: what the auto-publisher would do
 * next, per candidate, and the resolved D5 switch.
 */
export async function fetchAutoPublishStatus(): Promise<AutoPublishStatusResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/auto-publish/status`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<AutoPublishStatusResponse>(res, `GET ${url}`);
}

// ────────────────────────── per-kind authorship tiers ──────────────────────────

/**
 * One kind's row, exactly as coord projects it (`list_prompt_document_kind_tiers`).
 *
 * Coord answers one row per KIND rather than one per stored row, and the extra
 * fields are the reason: `builtin_default_tier` is a compile-time fact that is
 * not in the table at all, so a response listing only stored rows would make
 * this console infer it — and it would infer it wrong for precisely the kinds
 * where the answer matters.
 */
export interface KindTierRow {
  kind: string;
  /**
   * The stored tier, or `null` for "this tenant has expressed no opinion".
   *
   * `null` is ALSO what coord sends for a stored value it cannot interpret —
   * `unreadable` is the only thing separating the two, and they resolve in
   * opposite directions. Never render this field without consulting that one.
   */
  tier: AgentWriteTier | null;
  /**
   * A row EXISTS and coord cannot read its `tier`. Enforcement fail-closes to
   * `deny` on it, so the honest display is UNKNOWN — never coord's built-in
   * default, which is what an unset row falls through to.
   */
  unreadable: boolean;
  /**
   * The TIER coord's compile-time constant gives this kind, in the same
   * vocabulary as `tier` and `effective_tier`. A stored tier at either level
   * moves it, in EITHER direction.
   *
   * `"allow"` for a kind with no kind-wide entry at all.
   *
   * **Tier-valued, not boolean.** It was `builtin_default_denies: boolean`
   * until coord gave the six intent kinds a compiled default of
   * `"allow_with_notification"`, which a boolean cannot hold: it would have
   * flipped to `false` for those kinds and this console's "coord's compile-time
   * default denies this kind" copy would have become silently wrong in the
   * permissive direction.
   *
   * Typed as `string`, not `AgentWriteTier`, for the same reason
   * `effective_tier` is: this interface is a cast over `JSON.parse` output
   * rather than a check. Optional because a coord that predates the field sends
   * nothing — UNKNOWN, never open.
   *
   * **The `floor` and `settable` booleans that used to sit here are GONE.**
   * Coord removed the unliftable kind-wide FLOOR level from its resolver, so
   * both were permanently `false` / `true` — a dead guard with a `Lock` icon
   * attached in this console, which is a promise about a control that no longer
   * exists. Every kind is settable now, and there is nothing left for a
   * `settable` field to assert.
   */
  builtin_default_tier?: string;
  /**
   * **What coord will actually enforce** for a document of this kind with no
   * per-document row of its own — derived SERVER-SIDE by coord's own resolver.
   *
   * This is the field the badge renders. The fields above are the WHY, not the
   * answer: re-deriving the answer from them puts the never-overstate-access
   * rule in this console, where the obvious join
   * (`tier ?? builtin_default_tier`) renders `allow` for an unreadable tier on
   * a kind whose compiled default allows — which coord DENIES.
   *
   * Typed as `string`, not `AgentWriteTier`: this interface is a cast over
   * `JSON.parse` output rather than a check, so a tier this build predates
   * arrives here as an arbitrary string. Narrow it with `isAgentWriteTier`
   * before rendering, and treat anything else as UNKNOWN.
   *
   * Optional because a coord that predates the field sends nothing — which is
   * UNKNOWN, never open.
   */
  effective_tier?: string;
  /**
   * Which step of coord's resolution order produced `effective_tier`:
   * `"kind"` (this tenant's stored setting) or `"default"` (coord's
   * compile-time answer, whatever tier that is).
   *
   * There was a `"floor"` arm until coord deleted the floor level; it is gone
   * rather than kept as a value nothing can produce.
   *
   * Not derivable from the other fields, and it changes the REMEDY: an operator
   * reading "denied" needs to know whether their own setting or a coord
   * constant did it.
   */
  effective_source?: string;
  /**
   * The document NAMES under this kind that a kind-wide `allow` will NOT reach
   * — coord's compiled-in per-document denies, answered at resolution step 2b,
   * ABOVE the per-kind table this control writes.
   *
   * Without it the control misreports in the permissive direction, which is the
   * one that matters: `policy` arrives with a live control and a
   * `builtin_default_tier` of `"allow"`, so an operator setting it to `allow`
   * would reasonably read that as opening every policy document — including
   * `policy/session-protocol`, `policy/security-and-autonomy` and
   * `policy/escalation-bar`, the three documents that ARE the authority
   * interpreting every other document. It does not, and coord's resolver is
   * what makes that true; this field is what makes it VISIBLE.
   *
   * Empty for most kinds, including all six intent kinds — their compiled-in
   * answer is a liftable `KindDefaultTier`, which is exactly what this lever
   * exists to move.
   *
   * Optional because a coord that predates the field sends nothing. Absent is
   * UNKNOWN, and the honest render for UNKNOWN here is nothing at all — an
   * empty carve-out list would be a positive claim that a kind-wide `allow`
   * reaches every document, which is the exact overstatement this field exists
   * to prevent.
   */
  protected_documents?: string[];
}

/** `GET /coord/prompt-document-kind-tiers` body — `list_prompt_document_kind_tiers`. */
export interface KindTiersResponse {
  kinds: KindTierRow[];
  vocabulary: AgentWriteTier[];
  /**
   * Whether the deployed coord ENFORCES the `allow_with_notification`
   * precondition. Coord sends it on every response.
   *
   * It was `false` when this hook was written and is `true` from coord#1702,
   * which shipped the precondition. Read it, never assume either value — the
   * console talks to whatever coord is deployed, and a stale local belief about
   * this flag is how three hardcoded "NOT YET ENFORCED" strings went on
   * describing a world that had already changed.
   *
   * Typed `boolean` but arriving through `JSON.parse`, so a coord that predates
   * the field sends nothing. Absent is NOT enforced — see the consumer's
   * `isEnforced`.
   */
  notification_enforced: boolean;
  /**
   * Coord's own prose statement of what `allow_with_notification` does on the
   * coord that answered.
   *
   * NOT content-free once the precondition is enforced, which is why coord kept
   * the field rather than deleting it with the caveat it used to carry: the
   * enforced text states the positive fact AND the one residual the tier cannot
   * promise away — the subtractive `policy_write` dial, applied after
   * authorization, which can still refuse a write the tier permitted. Render it
   * in both states.
   */
  warning: string;
}

/** `GET /coord/prompt-document-kind-tiers` — one row per kind. */
export async function fetchKindTiers(): Promise<KindTiersResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<KindTiersResponse>(res, `GET ${url}`);
}

/**
 * `PUT /coord/prompt-document-kind-tiers/{kind}` —
 * `set_prompt_document_kind_tier`. An assignment, so a repeat is harmless.
 */
export async function setKindTier(
  kind: string,
  tier: AgentWriteTier
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers/${encodeURIComponent(kind)}`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ tier }),
    idempotent: true,
  });
  return readJson<unknown>(res, `PUT ${url}`, { unparseable: "null" });
}

/**
 * `DELETE /coord/prompt-document-kind-tiers/{kind}` —
 * `clear_prompt_document_kind_tier`: back to coord's compile-time default.
 */
export async function clearKindTier(kind: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers/${encodeURIComponent(kind)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

// ─────────────────────────── session compliance ───────────────────────────

/** `GET /coord/session-compliance/config` — `get_session_compliance_config`. */
export async function fetchSessionComplianceConfig(): Promise<SessionComplianceConfig> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<SessionComplianceConfig>(res, `GET ${url}`);
}

/**
 * `GET /coord/session-compliance/config/versions` —
 * `list_session_compliance_config_versions`: the settings' audit trail.
 */
export async function listSessionComplianceConfigVersions(): Promise<ListConfigVersionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config/versions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListConfigVersionsResponse>(res, `GET ${url}`);
}

/**
 * `PUT /coord/session-compliance/config` — `put_session_compliance_config`.
 * Coord versions the row; the body is a full assignment of the fields sent, so
 * a repeat is harmless (`PUT`, idempotent by method).
 */
export async function saveSessionComplianceConfig(
  patch: SessionComplianceConfigUpdate
): Promise<SessionComplianceConfig> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(patch),
    idempotent: true,
  });
  return readJson<SessionComplianceConfig>(res, `PUT ${url}`);
}

/**
 * `GET /coord/session-compliance/sessions?limit=&verdict=&cursor=` —
 * `list_session_compliance_sessions`. `verdict` and `cursor` are sent only when
 * given, in that order after `limit`.
 */
export async function listSessionComplianceSessions(params: {
  limit: number;
  verdict?: string;
  cursor?: string | null;
}): Promise<ListComplianceSessionsResponse> {
  const qs = new URLSearchParams({ limit: String(params.limit) });
  if (params.verdict) qs.set("verdict", params.verdict);
  if (params.cursor) qs.set("cursor", params.cursor);
  const url = `${OPERATIONS_BASE}/coord/session-compliance/sessions?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListComplianceSessionsResponse>(res, `GET ${url}`);
}

/**
 * `GET /coord/session-compliance/outstanding` —
 * `list_session_compliance_outstanding`: the outstanding-work ledger.
 */
export async function listSessionComplianceOutstanding(): Promise<ListOutstandingResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/outstanding`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListOutstandingResponse>(res, `GET ${url}`);
}

// ──────────────────────── proposals and the write feed ────────────────────────

/**
 * `GET /coord/prompt-document-proposals?status=pending` —
 * `list_prompt_document_proposals` for the working queue. Sends no `limit`, so
 * coord applies its own page size.
 */
export async function listPendingPromptDocumentProposals(): Promise<ListPolicyProposalsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-proposals?status=pending`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPolicyProposalsResponse>(res, `GET ${url}`);
}

/**
 * `GET /coord/prompt-document-proposals?status=&limit=` —
 * `list_prompt_document_proposals` for a bounded, status-filtered section
 * (the retired and recently-decided receipts).
 */
export async function listPromptDocumentProposals(
  status: string,
  limit: number
): Promise<ListPolicyProposalsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-proposals?status=${encodeURIComponent(status)}&limit=${limit}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPolicyProposalsResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-document-proposals/{id}/approve|reject` —
 * `approve_prompt_document_proposal` / `reject_prompt_document_proposal`. The
 * decider is stamped server-side; `decision_note` is sent only when non-empty.
 * Never re-sent on a 5xx: an approve applies the edit.
 */
export async function decidePromptDocumentProposal(
  proposalId: string,
  action: "approve" | "reject",
  decisionNote: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-proposals/${encodeURIComponent(proposalId)}/${action}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(decisionNote ? { decision_note: decisionNote } : {}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `GET /coord/prompt-document-writes?limit=` — `list_prompt_document_writes`:
 * the recently landed writes, with every caveat coord attached.
 */
export async function listPromptDocumentWrites(
  limit: number
): Promise<ListWritesResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-writes?limit=${limit}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListWritesResponse>(res, `GET ${url}`);
}
