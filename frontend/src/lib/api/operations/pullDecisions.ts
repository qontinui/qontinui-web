/**
 * `GET /operations/coord/pull-decisions` — recorded pull-conflict resolutions.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Resolves `unknown` on purpose: the page tolerates both a
 * `{resolutions: [...]}` envelope and a bare array, and only it decides which.
 * `query` is the caller's already-encoded query string (`""` for none, else
 * starting with `?`).
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export async function fetchPullDecisions(
  query: string,
  options?: HttpOptions
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/pull-decisions${query}`;
  const res = await httpClient.fetch(url, { ...options, method: "GET" });
  return readJson<unknown>(res, `GET ${url}`);
}
