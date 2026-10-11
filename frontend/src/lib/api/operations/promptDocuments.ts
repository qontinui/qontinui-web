/**
 * `/operations/coord/prompt-documents*` and
 * `/operations/coord/prompt-document-publications*` — the policy console's
 * clause editor, cross-tenant publication channel and publish-all door.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5 + D6, Phase 7). Every function inlines its URL over `OPERATIONS_BASE`,
 * calls `httpClient.fetch` directly and parses through `readJson`, so a
 * non-2xx rejects with `<METHOD> <url> failed: <status> - <body>` exactly as
 * the `httpClient` helpers it replaces did (the hooks' refusal classifiers
 * sniff that text). The wire types stay with the console in
 * `app/(app)/admin/coord/prompt-documents/types.ts`.
 */

import type {
  AutoPublishStatusResponse,
  Clause,
  ClauseConflictChoice,
  ClauseCreate,
  ClauseMergeApplyResponse,
  ClauseMergePreview,
  ClauseUpdate,
  ListClausesResponse,
  ListPublicationsResponse,
  PromptDocumentKind,
  Publication,
  PublishAllArmedResponse,
  PublishAllDryRunResponse,
  PublishAllItem,
  PublishResponse,
  UpstreamDecisionResponse,
} from "@/app/(app)/admin/coord/prompt-documents/types";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ---- clauses ----------------------------------------------------------

/** `GET /coord/prompt-documents/:kind/:name/clauses`. */
export async function fetchClauses(
  kind: PromptDocumentKind,
  name: string
): Promise<ListClausesResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListClausesResponse>(res, `GET ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/clauses`. */
export async function createClause(
  kind: PromptDocumentKind,
  name: string,
  body: ClauseCreate
): Promise<Clause> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<Clause>(res, `POST ${url}`);
}

/** `PATCH /coord/prompt-documents/:kind/:name/clauses/:clauseId`. */
export async function updateClause(
  kind: PromptDocumentKind,
  name: string,
  clauseId: string,
  body: ClauseUpdate
): Promise<Clause> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/${encodeURIComponent(clauseId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return readJson<Clause>(res, `PATCH ${url}`);
}

/** `DELETE /coord/prompt-documents/:kind/:name/clauses/:clauseId` (204 allowed). */
export async function deleteClause(
  kind: PromptDocumentKind,
  name: string,
  clauseId: string
): Promise<void> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/${encodeURIComponent(clauseId)}`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
  if (res.status === 204) return;
  await readJson<unknown>(res, `DELETE ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/clauses/reorder`. */
export async function reorderClauses(
  kind: PromptDocumentKind,
  name: string,
  clauseIds: string[]
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/clauses/reorder`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ clause_ids: clauseIds }),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

// ---- the document itself ----------------------------------------------

/**
 * `PATCH /coord/prompt-documents/:kind/:name`. `idempotent` is the caller's
 * claim that re-issuing the same body changes nothing (an attrs-only edit).
 */
export async function patchPromptDocument(
  kind: PromptDocumentKind,
  name: string,
  body: unknown,
  options?: { idempotent?: boolean }
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    ...(options?.idempotent ? { idempotent: true } : {}),
  });
  return readJson<unknown>(res, `PATCH ${url}`);
}

// ---- publications -----------------------------------------------------

/** `GET /coord/prompt-document-publications?kind=&name=` (bodies omitted). */
export async function fetchPublications(
  kind: PromptDocumentKind,
  name: string
): Promise<ListPublicationsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-publications?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPublicationsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-document-publications/:kind/:name/:version`, with body. */
export async function fetchPublication(
  kind: PromptDocumentKind,
  name: string,
  version: number
): Promise<Publication> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-publications/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/${version}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<Publication>(res, `GET ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/publish`. */
export async function publishDocument(
  kind: PromptDocumentKind,
  name: string,
  body: { release_note: string | null; expected_version: number }
): Promise<PublishResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/publish`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<PublishResponse>(res, `POST ${url}`);
}

// ---- modified-tenant upstream decisions -------------------------------

/** The body of `upstream-adopt` / `upstream-keep`. */
export interface UpstreamDecisionBody {
  publication_version: number;
  expected_version: number;
}

/** `POST /coord/prompt-documents/:kind/:name/upstream-adopt`. */
export async function adoptUpstream(
  kind: PromptDocumentKind,
  name: string,
  body: UpstreamDecisionBody
): Promise<UpstreamDecisionResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-adopt`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<UpstreamDecisionResponse>(res, `POST ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/upstream-keep`. */
export async function keepUpstream(
  kind: PromptDocumentKind,
  name: string,
  body: UpstreamDecisionBody
): Promise<UpstreamDecisionResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-keep`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<UpstreamDecisionResponse>(res, `POST ${url}`);
}

/** `GET /coord/prompt-documents/:kind/:name/upstream-merge?publication_version=` (preview). */
export async function fetchUpstreamMergePreview(
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number
): Promise<ClauseMergePreview> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-merge?publication_version=${publicationVersion}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ClauseMergePreview>(res, `GET ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/upstream-merge`. */
export async function applyUpstreamMerge(
  kind: PromptDocumentKind,
  name: string,
  body: UpstreamDecisionBody & {
    resolutions: Record<string, ClauseConflictChoice>;
  }
): Promise<ClauseMergeApplyResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/upstream-merge`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<ClauseMergeApplyResponse>(res, `POST ${url}`);
}

// ---- publish-all and the auto-publisher -------------------------------

/** `POST /coord/prompt-documents/publish-all` with `dry_run: true` — the preview. */
export async function previewPublishAll(): Promise<PublishAllDryRunResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/publish-all`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ dry_run: true }),
  });
  return readJson<PublishAllDryRunResponse>(res, `POST ${url}`);
}

/**
 * `POST /coord/prompt-documents/publish-all` armed. `dry_run: false` is sent
 * explicitly: on this door it defaults to TRUE, so omitting it would take a
 * preview and report it as a publication.
 */
export async function runPublishAll(body: {
  release_note: string | null;
  items: PublishAllItem[];
}): Promise<PublishAllArmedResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/publish-all`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      dry_run: false,
      release_note: body.release_note,
      items: body.items,
    }),
  });
  return readJson<PublishAllArmedResponse>(res, `POST ${url}`);
}

/** `GET /coord/prompt-documents/auto-publish/status`. */
export async function fetchAutoPublishStatus(): Promise<AutoPublishStatusResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/auto-publish/status`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<AutoPublishStatusResponse>(res, `GET ${url}`);
}
