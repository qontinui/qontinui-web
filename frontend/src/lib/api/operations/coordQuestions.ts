/**
 * `/operations/agent-questions/*` — the questions agents ask the operator, and
 * the operator's response.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5, Phase 7). The list reads return `unknown`: the caller's
 * `extractQuestions` / `extractQuestion` validate the envelope, tolerating a
 * bare list. Reads take the caller's `HttpOptions` (polls pass
 * `COORD_DASHBOARD_POLL_OPTIONS`; an operator's click keeps the default
 * retries).
 *
 * Each function calls `httpClient.fetch` directly with its URL inline; a
 * shared `request(path)` helper would be a wrapper of a wrapper, which
 * `route-walker.test.ts` cannot resolve. The `gap=true` reads are their own
 * functions for the same reason: the walker reads a literal path.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `post_agent_question_response` request. */
export interface AgentQuestionResponseRequest {
  response: string;
  responded_by_operator: string;
}

/** `GET /agent-questions/pending` (`get_pending_agent_questions`). */
export async function fetchPendingQuestions(
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

/** `GET /agent-questions/pending?gap=true` — the POLICY_GAP hint form. */
export async function fetchPendingGapQuestions(
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

/** `GET /agent-questions/answered?limit=N` (`get_answered_agent_questions`). */
export async function fetchAnsweredQuestions(
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

/** `GET /agent-questions/answered?gap=true&limit=N` — the POLICY_GAP hint form. */
export async function fetchAnsweredGapQuestions(
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

/** `GET /agent-questions/{question_id}` (`get_agent_question`). */
export async function fetchQuestion(
  questionId: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(questionId)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `POST /agent-questions/{question_id}/respond`
 * (`post_agent_question_response`) — answer an agent. Not declared
 * idempotent, so a 5xx is never replayed; the caller ignores the body.
 */
export async function respondToQuestion(
  questionId: string,
  request: AgentQuestionResponseRequest
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(questionId)}/respond`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
