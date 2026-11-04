/**
 * The fleet Rust advisory census: `GET /coord/dependency-advisories`, read
 * through the web backend's `/operations` proxy (plan
 * `2026-11-02-rust-advisories-have-no-fleet-consumer` Phase 5).
 *
 * Part of the typed `/operations` client. The handler
 * (`get_coord_dependency_advisories`) passes coord's body and its error
 * answers through verbatim, so a non-2xx rejects through `readJson` as
 * `GET <url> failed: <status> - <body>` — the shape `httpStatusOf` /
 * `httpBodyOf` read, which is how the hook tells coord's
 * `503 dependency_advisories_surface_unavailable` apart from any other
 * failure. Returns `unknown`: the one reader, `useDependencyAdvisories`,
 * validates the body with `parseDependencyAdvisoriesPayload` (in
 * `components/operations/dependencyAdvisories.ts`) before anything renders
 * it.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** The filters `GET /coord/dependency-advisories` accepts. */
export interface DependencyAdvisoriesQuery {
  /** `owner/name`; absent or empty = every repo the tenant has a census for. */
  repo?: string | null;
  /** Also return advisories whose `resolved_at` is set. Default `false`. */
  includeResolved?: boolean;
}

/**
 * `GET /coord/dependency-advisories?include_resolved=&repo=` — one census row
 * per repo with its advisories. `include_resolved` always rides the query (so
 * the request says what it asked for); `repo` only when set.
 */
export async function fetchDependencyAdvisories(
  query: DependencyAdvisoriesQuery = {},
  options: HttpOptions = {}
): Promise<unknown> {
  const params = new URLSearchParams({
    include_resolved: String(query.includeResolved ?? false),
  });
  if (query.repo) params.set("repo", query.repo);
  const url = `${OPERATIONS_BASE}/coord/dependency-advisories?${params.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
