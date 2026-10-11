/**
 * `/operations/agent-questions/{pending,answered}` — the agent-question
 * inboxes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Both resolve `unknown` on purpose: the page tolerates a bare array
 * and an enveloped one and normalises through its own `extractQuestions`.
 * `query` is the caller's query string WITHOUT the leading `?` (`""` for none).
 * The caller owns the retry policy (`options`).
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /agent-questions/pending[?query]`. */
export async function fetchPendingQuestions(
  query: string,
  options?: HttpOptions
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/pending${query ? `?${query}` : ""}`;
  const res = await httpClient.fetch(url, { ...options, method: "GET" });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /agent-questions/answered[?query]`. */
export async function fetchAnsweredQuestions(
  query: string,
  options?: HttpOptions
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/answered${query ? `?${query}` : ""}`;
  const res = await httpClient.fetch(url, { ...options, method: "GET" });
  return readJson<unknown>(res, `GET ${url}`);
}
