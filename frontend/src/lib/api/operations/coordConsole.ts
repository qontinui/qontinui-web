/**
 * `/operations` reads and writes behind the coord console's row components and
 * its always-mounted chrome: the nav's unread-notifications badge, the deploy
 * row's rollback proposal, the gap row's two writes, the land row's cross-repo
 * verdict, and the red-main banner's alert poll.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline and returns the PARSED body
 * through `readJson`; a non-2xx rejects with `<METHOD> <url> failed: <status> -
 * <body>`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import type { RollbackProposal } from "@/components/admin/coord/deployTypes";
import { OPERATIONS_BASE, readJson } from "./base";

/** The one field of `GET /notifications` the nav badge reads. */
export interface NotificationsUnreadBody {
  unread_count?: number;
}

/**
 * `GET /notifications?limit=1` — the feed's unread rollup, for the nav badge.
 * `options` carries the caller's retry policy (`NOTIFICATIONS_REQUEST_OPTIONS`).
 */
export async function fetchNotificationsUnread(
  options: HttpOptions = {}
): Promise<NotificationsUnreadBody> {
  const url = `${OPERATIONS_BASE}/notifications?limit=1`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<NotificationsUnreadBody>(res, `GET ${url}`);
}

/**
 * `GET /deploys/{id}/rollback-proposal` — the on-demand rollback proposal.
 * Coord 404s when the latest verification does not justify a rollback.
 */
export async function fetchRollbackProposal(
  deployId: string
): Promise<RollbackProposal> {
  const url = `${OPERATIONS_BASE}/deploys/${deployId}/rollback-proposal`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<RollbackProposal>(res, `GET ${url}`);
}

/** The body of `POST /agent-questions/{id}/respond`. */
export interface AgentQuestionResponseWrite {
  response: string;
  responded_by_operator: string;
}

/** `POST /agent-questions/{id}/respond` — a durable answer to a pending question. */
export async function respondToAgentQuestion(
  questionId: string,
  write: AgentQuestionResponseWrite
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(
    questionId
  )}/respond`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(write),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/**
 * `POST /coord/prompt-documents/policy/{category}/clauses` — the Phase-2
 * clause-create proxy. `clause` is the proposed clause as the gap carried it.
 */
export async function createPolicyClause(
  category: string,
  clause: unknown
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/policy/${encodeURIComponent(
    category
  )}/clauses`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(clause),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

// Wire shapes mirror coord's `/coord/restacks/verifications` response
// (snake_case). Rendered defensively — `worst_drift_class` / `d3_outcome` /
// `verified_at` are null until a repo is verified.
export interface RepoVerification {
  repo: string;
  signature_id?: string | null;
  worst_drift_class?: string | null;
  d3_outcome?: string | null;
  verified_at?: string | null;
  edge_verdicts?: unknown[] | null;
}

export interface ComposedVerification {
  worst_drift_class?: string | null;
  repo_count?: number | null;
  verified_count?: number | null;
}

export interface CrossRepoVerifications {
  correlation_id?: string | null;
  repos?: RepoVerification[] | null;
  composed?: ComposedVerification | null;
}

/**
 * `GET /lands/verifications?correlation_id=…` — the composed restack
 * verification verdict for a land's cascade (proxy of coord's
 * `/coord/restacks/verifications`).
 */
export async function fetchLandVerifications(
  correlationId: string
): Promise<CrossRepoVerifications> {
  const qs = new URLSearchParams({ correlation_id: correlationId });
  const url = `${OPERATIONS_BASE}/lands/verifications?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CrossRepoVerifications>(res, `GET ${url}`);
}

/**
 * `GET /alerts?include_resolved=false&kind={kind}` — the open alerts of one
 * kind. Resolves `unknown` on purpose: coord has served both a
 * `{alerts: [...]}` envelope and a bare list, and the caller tolerates both.
 * `options` carries the poll's retry budget (`COORD_DASHBOARD_POLL_OPTIONS`).
 */
export async function fetchOpenAlertsByKind(
  kind: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/alerts?include_resolved=false&kind=${kind}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
