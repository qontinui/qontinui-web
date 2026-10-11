/**
 * `/operations/plans/overview` — coord's plan-library overview.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5 + D6, Phase 7). Inlines its URL over `OPERATIONS_BASE`, calls
 * `httpClient.fetch` directly and parses through `readJson`.
 */

import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /plans/overview`. The one caller reads only `derive_mode` off it, so
 * the body is `unknown`. A dashboard poll: one request, the next poll is the
 * retry.
 */
export async function fetchPlansOverview(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/plans/overview`;
  const res = await httpClient.fetch(url, {
    ...COORD_DASHBOARD_POLL_OPTIONS,
    method: "GET",
  });
  return readJson<unknown>(res, `GET ${url}`);
}
