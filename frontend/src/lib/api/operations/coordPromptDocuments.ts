/**
 * `/operations/coord/prompt-documents*`, `…/prompt-document-publications*`,
 * `…/prompt-document-kind-tiers*`, `…/prompt-document-proposals*`,
 * `…/prompt-document-writes` and `…/session-compliance/*` — the coord prompt
 * document (fleet policy) routes, as part of the typed `/operations` client
 * (plan `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7).
 *
 * Covers the documents themselves and their version history, the structured
 * clauses of a `policy` document, publications and the modified-tenant upstream
 * decisions, publish-all and its auto-publish status, the per-kind agent
 * authorship tiers, session compliance, and the operator review feed
 * (proposals and recent writes). Every one is a tenant-admin coord-proxy route
 * on the web backend (`backend/app/api/v1/endpoints/operations/__init__.py`);
 * reads are visible to any tenant member and writes are tenant-admin-gated
 * (coord re-checks).
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * with its URL inline (never through a shared `request(path)` helper, which
 * `route-walker.test.ts` cannot resolve), states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`, which is the string the callers'
 * refusal classifiers (`classifyPublishError`, `isRouteUnavailable`, …) read.
 *
 * The wire types are the pages' own, imported type-only from where they are
 * documented: `prompt-documents/types.ts`, `compliance-types.ts`,
 * `prompt-document-proposals/types.ts`.
 */

import type {
  AgentWriteTier,
  AutoPublishStatusResponse,
  Clause,
  ClauseConflictChoice,
  ClauseCreate,
  ClauseMergeApplyResponse,
  ClauseMergePreview,
  ClauseUpdate,
  ListClausesResponse,
  ListPromptDocumentsResponse,
  ListPublicationsResponse,
  ListVersionsResponse,
  PromptDocument,
  PromptDocumentCreate,
  PromptDocumentKind,
  PromptDocumentUpdate,
  PromptDocumentVersion,
  Publication,
  PublishAllArmedResponse,
  PublishAllDryRunResponse,
  PublishAllItem,
  PublishMode,
  PublishResponse,
  UpstreamDecisionResponse,
} from "@/app/(app)/admin/coord/prompt-documents/types";
import type {
  ComplianceVerdict,
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
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** A document-level PATCH body that is not (only) a `PromptDocumentUpdate`. */
export interface PublishModeUpdate {
  publish_mode: PublishMode;
  change_description: string;
}

/** `POST /coord/prompt-documents/:kind/:name/publish` body. */
export interface PublishDocumentBody {
  release_note: string | null;
  expected_version: number;
}

/** `POST /coord/prompt-documents/publish-all` armed-run body. */
export interface PublishAllArmedBody {
  dry_run: false;
  release_note: string | null;
  items: PublishAllItem[];
}

/** The query of `GET /coord/session-compliance/sessions`. */
export interface ComplianceSessionsQuery {
  limit: number;
  verdict?: ComplianceVerdict;
  cursor?: string;
}

/**
 * One kind's row, exactly as coord projects it.
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

// ── documents ───────────────────────────────────────────────────────────────

/**
 * `GET /coord/prompt-documents` — the tenant's documents WITHOUT bodies. Coord
 * seeds the canonical documents on first touch.
 */
export async function listPromptDocuments(): Promise<ListPromptDocumentsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPromptDocumentsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-documents/:kind/:name` — one document WITH its body. */
export async function fetchPromptDocument(
  kind: PromptDocumentKind,
  name: string
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PromptDocument>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/:kind` — create a hand-authored document (a
 * duplicate `(kind, name)` is coord's 409). Never re-sent on a 5xx.
 */
export async function createPromptDocument(
  kind: PromptDocumentKind,
  body: PromptDocumentCreate
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<PromptDocument>(res, `POST ${url}`);
}

/**
 * `PATCH /coord/prompt-documents/:kind/:name` — an edit. Coord snapshots a NEW
 * version, so a blind repeat after a lost 5xx would write a second one
 * (`idempotent: false`). The attrs-only edit is {@link patchPromptDocumentAttrs}.
 */
export async function updatePromptDocument(
  kind: string,
  name: string,
  body: PromptDocumentUpdate | PublishModeUpdate
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<PromptDocument>(res, `PATCH ${url}`);
}

/**
 * `PATCH /coord/prompt-documents/:kind/:name` with `{attrs}` only.
 *
 * Safe to re-issue (`idempotent: true`): `update_prompt_document` replaces
 * attrs in place with the merged object; an attrs-only edit creates no version
 * row.
 */
export async function patchPromptDocumentAttrs(
  kind: PromptDocumentKind,
  name: string,
  attrs: NonNullable<PromptDocumentUpdate["attrs"]>
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ attrs }),
    idempotent: true,
  });
  return readJson<unknown>(res, `PATCH ${url}`, { unparseable: "null" });
}

/** `POST /coord/prompt-documents/:kind/:name/restore-default` — re-seed from the code default. */
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

/** `GET /coord/prompt-documents/:kind/:name/versions` — history metadata, newest first. */
export async function fetchPromptDocumentVersions(
  kind: string,
  name: string
): Promise<ListVersionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/versions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListVersionsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-documents/:kind/:name/versions/:version` — one immutable snapshot, body included. */
export async function fetchPromptDocumentVersion(
  kind: string,
  name: string,
  version: number
): Promise<PromptDocumentVersion> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/versions/${version}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PromptDocumentVersion>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/:kind/:name/versions/:version/restore` — copy
 * that version's body forward as a NEW version (history is never rewritten).
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
 * `POST /coord/prompt-documents/:kind/:name/withdraw` — withdraw a CREATED
 * decision record (coord writes a new version marking it withdrawn).
 */
export async function withdrawPromptDocument(
  kind: string,
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

// ── clauses ─────────────────────────────────────────────────────────────────

/** `GET /coord/prompt-documents/:kind/:name/clauses` — a bare list or `{clauses}`. */
export async function listClauses(
  kind: PromptDocumentKind,
  name: string
): Promise<ListClausesResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListClausesResponse>(res, `GET ${url}`);
}

/** `POST …/clauses` — a duplicate `clause_id` is coord's 409. Never re-sent on a 5xx. */
export async function createClause(
  kind: PromptDocumentKind,
  name: string,
  body: ClauseCreate
): Promise<Clause | null> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<Clause>(res, `POST ${url}`, { unparseable: "null" });
}

/** `PATCH …/clauses/:clause_id`. Never re-sent on a 5xx. */
export async function updateClause(
  kind: PromptDocumentKind,
  name: string,
  clauseId: string,
  body: ClauseUpdate
): Promise<Clause | null> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/${encodeURIComponent(clauseId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<Clause>(res, `PATCH ${url}`, { unparseable: "null" });
}

/** `DELETE …/clauses/:clause_id` (may answer 204). */
export async function deleteClause(
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

/** `POST …/clauses/reorder` — persist a new order (array of clause ids). */
export async function reorderClauses(
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

// ── publications and the modified-tenant decisions ──────────────────────────

/** `GET /coord/prompt-document-publications?kind=&name=` — body-less list. */
export async function listPublications(
  kind: PromptDocumentKind,
  name: string
): Promise<ListPublicationsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-publications?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPublicationsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-document-publications/:kind/:name/:version` — one publication WITH its body. */
export async function fetchPublication(
  kind: PromptDocumentKind,
  name: string,
  version: number
): Promise<Publication> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-publications/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/${version}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<Publication>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-documents/:kind/:name/publish` — promote this tenant's
 * current body into the next publication. Never re-sent on a 5xx: a repeat
 * could publish twice.
 */
export async function publishPromptDocument(
  kind: PromptDocumentKind,
  name: string,
  body: PublishDocumentBody
): Promise<PublishResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/publish`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<PublishResponse>(res, `POST ${url}`);
}

/** `POST …/upstream-adopt` — replace the body with the publication and advance the tracked version. */
export async function adoptUpstreamPublication(
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number,
  expectedVersion: number
): Promise<UpstreamDecisionResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-adopt`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      publication_version: publicationVersion,
      expected_version: expectedVersion,
    }),
    idempotent: false,
  });
  return readJson<UpstreamDecisionResponse>(res, `POST ${url}`);
}

/** `POST …/upstream-keep` — record "reviewed publication N, declined". */
export async function keepOwnAgainstUpstream(
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number,
  expectedVersion: number
): Promise<UpstreamDecisionResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-keep`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      publication_version: publicationVersion,
      expected_version: expectedVersion,
    }),
    idempotent: false,
  });
  return readJson<UpstreamDecisionResponse>(res, `POST ${url}`);
}

/** `GET …/upstream-merge?publication_version=` — the read-only clause merge preview. */
export async function fetchUpstreamMergePreview(
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number
): Promise<ClauseMergePreview> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-merge?publication_version=${publicationVersion}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ClauseMergePreview>(res, `GET ${url}`);
}

/** `POST …/upstream-merge` — land a reviewed clause-grained merge. */
export async function applyUpstreamMerge(
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number,
  expectedVersion: number,
  resolutions: Record<string, ClauseConflictChoice>
): Promise<ClauseMergeApplyResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-merge`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      publication_version: publicationVersion,
      expected_version: expectedVersion,
      resolutions,
    }),
    idempotent: false,
  });
  return readJson<ClauseMergeApplyResponse>(res, `POST ${url}`);
}

// ── publish-all ─────────────────────────────────────────────────────────────

/**
 * `POST /coord/prompt-documents/publish-all` with `{dry_run: true}` — the
 * preview: every changed document with the version it would publish. Changes
 * nothing, but it is still a POST (`idempotent: false` keeps the helpers'
 * original retry rule).
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
 * `POST /coord/prompt-documents/publish-all` armed run. `dry_run: false` is
 * explicit and never omitted: on publish-all `dry_run` defaults to TRUE, so
 * leaving it out would take another preview and report it as a publication.
 * Never re-sent on a 5xx.
 */
export async function publishAllDocuments(
  body: PublishAllArmedBody
): Promise<PublishAllArmedResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/publish-all`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<PublishAllArmedResponse>(res, `POST ${url}`);
}

/** `GET /coord/prompt-documents/auto-publish/status` — what the auto-publisher would do next, per candidate. */
export async function fetchAutoPublishStatus(): Promise<AutoPublishStatusResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/auto-publish/status`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<AutoPublishStatusResponse>(res, `GET ${url}`);
}

// ── per-kind agent authorship tiers ─────────────────────────────────────────

/** `GET /coord/prompt-document-kind-tiers` — one row per KIND, as coord projects it. */
export async function fetchKindTiers(): Promise<KindTiersResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<KindTiersResponse>(res, `GET ${url}`);
}

/** `PUT /coord/prompt-document-kind-tiers/:kind` — set one kind's tier. */
export async function putKindTier(
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

/** `DELETE /coord/prompt-document-kind-tiers/:kind` — back to coord's compile-time default. */
export async function deleteKindTier(kind: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers/${encodeURIComponent(kind)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

// ── session compliance ──────────────────────────────────────────────────────

/** `GET /coord/session-compliance/config` — the enforcement settings. */
export async function fetchComplianceConfig(): Promise<SessionComplianceConfig> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<SessionComplianceConfig>(res, `GET ${url}`);
}

/** `PUT /coord/session-compliance/config` — coord versions the row; answers the saved config. */
export async function putComplianceConfig(
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

/** `GET /coord/session-compliance/config/versions` — the setting history. */
export async function fetchComplianceConfigVersions(): Promise<ListConfigVersionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config/versions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListConfigVersionsResponse>(res, `GET ${url}`);
}

/** `GET /coord/session-compliance/sessions?limit=&verdict=&cursor=` — per-session verdicts. */
export async function fetchComplianceSessions(
  query: ComplianceSessionsQuery
): Promise<ListComplianceSessionsResponse> {
  const qs = new URLSearchParams({ limit: String(query.limit) });
  if (query.verdict) qs.set("verdict", query.verdict);
  if (query.cursor) qs.set("cursor", query.cursor);
  const url = `${OPERATIONS_BASE}/coord/session-compliance/sessions?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListComplianceSessionsResponse>(res, `GET ${url}`);
}

/** `GET /coord/session-compliance/outstanding` — the outstanding-obligation ledger. */
export async function fetchComplianceOutstanding(): Promise<ListOutstandingResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/outstanding`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListOutstandingResponse>(res, `GET ${url}`);
}

// ── the operator review feed ────────────────────────────────────────────────

/**
 * `GET /coord/prompt-document-proposals?status=` (`&limit=` when given) — the
 * policy-edit proposals in one status. The pending queue passes no limit; the
 * collapsed retired/decided sections pass a small receipt-sized one.
 */
export async function listPolicyProposals(
  status: string,
  limit?: number
): Promise<ListPolicyProposalsResponse> {
  const url =
    limit === undefined
      ? `${OPERATIONS_BASE}/coord/prompt-document-proposals?status=${encodeURIComponent(status)}`
      : `${OPERATIONS_BASE}/coord/prompt-document-proposals?status=${encodeURIComponent(status)}&limit=${limit}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPolicyProposalsResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/prompt-document-proposals/:id/approve` | `…/reject` — decide a
 * proposal. Approving applies the edit, so it is never re-sent on a 5xx. An
 * empty `decisionNote` sends `{}`.
 */
export async function decidePolicyProposal(
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

/** `GET /coord/prompt-document-writes?limit=` — the recently landed writes. */
export async function listPromptDocumentWrites(
  limit: number
): Promise<ListWritesResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-writes?limit=${limit}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListWritesResponse>(res, `GET ${url}`);
}
