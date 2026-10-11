/**
 * `/operations/coord/prompt-documents` — the tenant's prompt documents through
 * the coord proxy: the list, one document, its version history and snapshots,
 * and the create / edit / restore / withdraw writes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. `kind` and `name` are encoded per
 * segment. A non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 */

import { httpClient } from "@/services/service-factory";
import type {
  ListPromptDocumentsResponse,
  ListVersionsResponse,
  PromptDocument,
  PromptDocumentCreate,
  PromptDocumentUpdate,
  PromptDocumentVersion,
} from "@/app/(app)/admin/coord/prompt-documents/types";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /coord/prompt-documents` — every document, bodies omitted. */
export async function fetchPromptDocumentList(): Promise<ListPromptDocumentsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPromptDocumentsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-documents/:kind/:name` — one document WITH its body. */
export async function fetchPromptDocument(
  kind: string,
  name: string
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PromptDocument>(res, `GET ${url}`);
}

/** `GET /coord/prompt-documents/:kind/:name/versions` — history metadata, newest first. */
export async function fetchPromptDocumentVersions(
  kind: string,
  name: string
): Promise<ListVersionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/versions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListVersionsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-documents/:kind/:name/versions/:version` — one immutable snapshot. */
export async function fetchPromptDocumentVersion(
  kind: string,
  name: string,
  version: number
): Promise<PromptDocumentVersion> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/versions/${version}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PromptDocumentVersion>(res, `GET ${url}`);
}

/** `POST /coord/prompt-documents/:kind` — create a hand-authored document. Never re-sent on a 5xx. */
export async function createPromptDocument(
  kind: string,
  data: PromptDocumentCreate
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(data),
    idempotent: false,
  });
  return readJson<PromptDocument>(res, `POST ${url}`);
}

/** `PATCH /coord/prompt-documents/:kind/:name` — coord snapshots a NEW version. Never re-sent on a 5xx. */
export async function updatePromptDocument(
  kind: string,
  name: string,
  data: PromptDocumentUpdate
): Promise<PromptDocument> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(data),
    idempotent: false,
  });
  return readJson<PromptDocument>(res, `PATCH ${url}`);
}

/** The body of an undo `PATCH`: a prior snapshot's text written back as a new version. */
export interface PromptDocumentRevert {
  body: string;
  change_description: string;
}

/**
 * `PATCH /coord/prompt-documents/:kind/:name` with a {@link PromptDocumentRevert}
 * — the review feed's one-click undo. Same route as {@link updatePromptDocument}
 * but its own function: the body is the feed's `change_description` shape, and
 * the caller ignores the response.
 */
export async function revertPromptDocument(
  kind: string,
  name: string,
  data: PromptDocumentRevert
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(data),
    idempotent: false,
  });
  return readJson<unknown>(res, `PATCH ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/restore-default` — re-seed from the code default. */
export async function restorePromptDocumentDefault(
  kind: string,
  name: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/restore-default`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/versions/:version/restore` — copy a snapshot forward as a new version. */
export async function restorePromptDocumentVersion(
  kind: string,
  name: string,
  version: number,
  changeNote?: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/versions/${version}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(changeNote ? { change_note: changeNote } : {}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `POST /coord/prompt-documents/:kind/:name/withdraw` — withdraw a created decision record. */
export async function withdrawPromptDocument(
  kind: string,
  name: string,
  reason: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/withdraw`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ reason }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}
