/**
 * `/operations` operator-touch read: the touch list with its window
 * aggregates and the constraint verdict, proxied from coord's
 * `GET /coord/operator-touches` (qontinui-coord `operator_touch_read.rs`).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Same conventions as `unfinished.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `GET <url> failed: <status> - <body>` — the shape the page's
 * `parseTouchReadFailure` reads coord's typed 400/503 bodies out of.
 *
 * The body is returned UNPARSED (`unknown`): the page's `readTouchesBody` is
 * the one validator of the wire shape, so a coord that drifts reads as
 * unknown there rather than being cast here.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /coord/operator-touches?<query>` — `query` is the already-encoded
 * query string (`window_days`, `limit`, `disposition`, `before`).
 */
export async function fetchOperatorTouches(query: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/operator-touches?${query}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}
