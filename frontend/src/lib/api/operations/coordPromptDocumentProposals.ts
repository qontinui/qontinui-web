/**
 * `/operations/coord/prompt-document-proposals` and
 * `/operations/coord/prompt-document-writes` — the policy-proposal review queue
 * and the recent-writes feed — through the coord proxy.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import type {
  ListPolicyProposalsResponse,
  ListWritesResponse,
} from "@/app/(app)/admin/coord/prompt-document-proposals/types";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /coord/prompt-document-proposals?status=` — one status-filtered section of the queue, at coord's default page size. */
export async function fetchPolicyProposals(
  status: string
): Promise<ListPolicyProposalsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-proposals?status=${encodeURIComponent(
    status
  )}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPolicyProposalsResponse>(res, `GET ${url}`);
}

/** `GET /coord/prompt-document-proposals?status=&limit=` — a bounded page of one status section. */
export async function fetchPolicyProposalsPage(
  status: string,
  limit: number
): Promise<ListPolicyProposalsResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-proposals?status=${encodeURIComponent(
    status
  )}&limit=${limit}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListPolicyProposalsResponse>(res, `GET ${url}`);
}

/** `POST /coord/prompt-document-proposals/:id/approve|reject` — decide one proposal. Never re-sent on a 5xx. */
export async function decidePolicyProposal(
  id: string,
  action: "approve" | "reject",
  decisionNote?: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-proposals/${encodeURIComponent(
    id
  )}/${action}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(decisionNote ? { decision_note: decisionNote } : {}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `GET /coord/prompt-document-writes?limit=` — the recent-writes review feed. */
export async function fetchPromptDocumentWrites(
  limit: number
): Promise<ListWritesResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-writes?limit=${limit}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListWritesResponse>(res, `GET ${url}`);
}
