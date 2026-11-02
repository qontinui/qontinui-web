/**
 * `/operations/agent-questions` — the operator inbox: the pending and answered
 * lists (plain and POLICY_GAP-filtered), one question by id, and the respond
 * door an operator's answer goes through.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 9). Same conventions as `coordMembers.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated,
 * and a non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>` —
 * the string `httpClient.get` / `post` threw at every call site before, over
 * the same relative url, so the error text the pages render is unchanged.
 *
 * Every handler named below lives in
 * `backend/app/api/v1/endpoints/operations/__init__.py` and proxies coord.
 *
 * The reads resolve `unknown` on purpose: the pages parse the body
 * defensively (`extractQuestions` / `extractQuestion`), because an
 * unrecognised 200 must read as UNKNOWN rather than as an empty inbox or a
 * question with every field undefined. A typed cast here would re-create the
 * blind cast those parsers replaced.
 *
 * Optional query keys get their own function rather than a branch on a URL
 * helper, so `route-walker.test.ts` sees every literal path.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** Who a pending question is addressed to (coord's `audience` column). */
export type AgentQuestionAudience = "operator" | "agent";

/** What {@link fetchPendingAgentQuestions} asks for. */
export interface PendingAgentQuestionsQuery {
  /** Page size; coord caps it and echoes the applied value as `limit`. */
  limit: number;
  /** Rows to skip; omitted (or 0) means the first page. */
  offset?: number;
  /** Narrow to one audience; omitted means every audience. */
  audience?: AgentQuestionAudience | null;
}

/**
 * `GET /agent-questions/pending?limit=<n>[&offset=<n>][&audience=<a>]`
 * (handler `get_pending_agent_questions`).
 *
 * Every key is one an older coord/proxy build may not know. FastAPI IGNORES an
 * unknown query parameter rather than rejecting it, so the degraded outcome is
 * "the filter did not apply", never a 422 — the caller reads the envelope back
 * (`limit` / `offset` echoes, each row's `audience`) rather than assuming the
 * request was obeyed.
 */
export async function fetchPendingAgentQuestions(
  query: PendingAgentQuestionsQuery,
  options: HttpOptions = {}
): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set("limit", String(query.limit));
  if (query.offset !== undefined && query.offset > 0) {
    qs.set("offset", String(query.offset));
  }
  if (query.audience) qs.set("audience", query.audience);
  const url = `${OPERATIONS_BASE}/agent-questions/pending?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /agent-questions/pending?gap=true&limit=` (handler
 * `get_pending_agent_questions`) — the blocking POLICY_GAP reports. `gap` is a
 * coord-side hint; the caller still filters on the POLICY_GAP marker.
 *
 * The limit is EXPLICIT: with none, coord applies its default page size and
 * the page length would read as the size of the gap queue. No `audience` is
 * sent, deliberately — a policy gap blocks whoever hit it, so narrowing the
 * queue to one audience would hide gaps rather than sort them.
 */
export async function fetchPendingPolicyGapQuestions(
  limit: number,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/pending?gap=true&limit=${limit}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /agent-questions/answered?limit=` (handler `get_answered_agent_questions`). */
export async function fetchAnsweredAgentQuestions(
  limit: number,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/answered?limit=${limit}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /agent-questions/answered?gap=true&limit=` (handler
 * `get_answered_agent_questions`) — the non-blocking, pre-answered POLICY_GAP
 * reports.
 */
export async function fetchAnsweredPolicyGapQuestions(
  limit: number,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/answered?gap=true&limit=${limit}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /agent-questions/{question_id}` (handler `get_agent_question`). */
export async function fetchAgentQuestion(questionId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(questionId)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `POST /agent-questions/{question_id}/respond` body — handler `post_agent_question_response`. */
export interface AgentQuestionResponseBody {
  response: string;
  responded_by_operator: string;
}

/**
 * `POST /agent-questions/{question_id}/respond` (handler
 * `post_agent_question_response`) — deliver an operator's answer to the agent.
 *
 * Never re-sent on a 5xx (`idempotent: false`): the answer is consumed by a
 * waiting agent, and coord 409s a second answer to an answered question. No
 * caller reads the result, so a 2xx whose body does not parse resolves `null`
 * — the 2xx is the fact that the answer landed.
 */
export async function respondToAgentQuestion(
  questionId: string,
  body: AgentQuestionResponseBody
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(questionId)}/respond`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
