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

/** `GET /agent-questions/pending` (handler `get_pending_agent_questions`). */
export async function fetchPendingAgentQuestions(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/pending`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /agent-questions/pending?gap=true` (handler
 * `get_pending_agent_questions`) — the blocking POLICY_GAP reports. `gap` is a
 * coord-side hint; the caller still filters on the POLICY_GAP marker.
 */
export async function fetchPendingPolicyGapQuestions(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/pending?gap=true`;
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
