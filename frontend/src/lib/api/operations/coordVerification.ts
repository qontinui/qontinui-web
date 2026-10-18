/**
 * `/operations/coord/verification/metrics` — coord's independent post-land
 * verification metrics, read by the overview's "Can I trust 'done'?" tile and
 * the `/admin/coord/verification` drill-down.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`).
 * Same conventions as `coordFindings.ts`: `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `GET <url> failed: <status> - <body>`.
 *
 * Handler: `get_coord_verification_metrics` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. Resolves `unknown`:
 * the shape is parsed by `parseVerificationMetrics`, which treats anything it
 * does not recognise as "could not look".
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /coord/verification/metrics?window=…` — one metrics answer. */
export async function fetchVerificationMetrics(
  window: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/verification/metrics?window=${encodeURIComponent(window)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}
