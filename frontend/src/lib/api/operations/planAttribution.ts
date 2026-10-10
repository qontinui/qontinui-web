/**
 * `/operations` plan attribution route: who shipped one plan's work unit.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`).
 * Same conventions as `coordFleet.ts`: `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `GET <url> failed: <status> - <body>` so `httpStatusOfError` reads it.
 *
 * The body is returned unparsed (`unknown`): the plans page derives its
 * reading through `deriveAttribution`, which treats every field as untrusted
 * (plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 7).
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /plans/{stem}/attribution` — the shipped-by sessions for one plan's
 * work unit. `options` carries the caller's retry budget; the plans page
 * passes `COORD_DASHBOARD_POLL_OPTIONS` (one request).
 */
export async function fetchPlanAttribution(
  slug: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}/attribution`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
