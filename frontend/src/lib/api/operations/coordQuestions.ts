/**
 * `/operations/agent-questions/{id}` — the question detail read and the
 * operator's respond write behind `/admin/coord/questions/[id]`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline and parses through
 * `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /agent-questions/{id}` — one question row. Resolves `unknown` on
 * purpose: a 2xx whose body is not a question row is UNKNOWN, and only the
 * caller's `extractQuestion` may decide what it is.
 */
export async function fetchAgentQuestion(id: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `POST /agent-questions/{id}/respond` — answer a question. Not re-sent on a
 * 5xx (`idempotent: false`): a gateway timeout can arrive after coord already
 * delivered the answer to the agent.
 */
export async function respondToAgentQuestion(
  id: string,
  response: string,
  respondedByOperator: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(id)}/respond`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      response,
      responded_by_operator: respondedByOperator,
    }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
