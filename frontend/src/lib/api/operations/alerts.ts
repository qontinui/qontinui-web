/**
 * `/operations/alerts` — the raw `coord.alerts` rows, narrowed to one kind.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 9). Same conventions as `coordMembers.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting
 * with `GET <url> failed: <status> - <body>`.
 *
 * Handler: `get_coord_alerts` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, a raw pass-through of
 * coord's `/coord/alerts`. The read resolves `unknown`: two coord vintages
 * answer in two shapes (`{alerts: [...]}` and a bare list), and the caller
 * (`RedMainBanner`) owns telling them apart and the row type.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /alerts?include_resolved=false&kind=` (handler `get_coord_alerts`) —
 * the unresolved alerts of one `coord.alerts.kind`. A coord that predates the
 * `kind` filter ignores it and answers the unfiltered rollup, so the caller
 * still filters. Polled, so the caller's retry budget.
 */
export async function fetchOpenAlertsOfKind(
  kind: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/alerts?include_resolved=false&kind=${encodeURIComponent(kind)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
