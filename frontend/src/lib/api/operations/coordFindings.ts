/**
 * `/operations/coord/findings` — the cross-session findings feed: one keyset
 * page under the page's filters, and the by-id read a deep link makes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 9). Same conventions as `coordMembers.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting
 * with `GET <url> failed: <status> - <body>` — the string `httpClient.get`
 * threw before, so coord's own words (a 400 on a stale cursor) reach the page
 * unchanged.
 *
 * Handler: `get_coord_findings` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. Both reads resolve
 * `unknown`: the page reads the envelope defensively (`readBody`), because the
 * proxy degrades an unanswering coord into an `unavailable` envelope rather
 * than a 502, and nothing in the body is assumed present.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * The list query `GET /coord/findings` honours. Keys are sent in this order;
 * an absent one (and a `triaged` of `null`) is omitted, never sent empty.
 */
export interface FindingsQuery {
  /** Page size asked of coord. Coord owns the clamp; this is a request. */
  limit: number;
  topic?: string;
  kind?: string;
  /** Sent as `resource_keys`. */
  resourceKeys?: string;
  /** `null` / absent sends no `triaged` key at all ("any"). */
  triaged?: boolean | null;
  /** Only ever a `next_cursor` coord minted for THIS query — never invented. */
  cursor?: string | null;
}

/** `GET /coord/findings?limit=…` (handler `get_coord_findings`) — one list page. */
export async function fetchCoordFindings(
  query: FindingsQuery
): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set("limit", String(query.limit));
  if (query.topic) qs.set("topic", query.topic);
  if (query.kind) qs.set("kind", query.kind);
  if (query.resourceKeys) qs.set("resource_keys", query.resourceKeys);
  if (query.triaged !== null && query.triaged !== undefined)
    qs.set("triaged", String(query.triaged));
  if (query.cursor) qs.set("cursor", query.cursor);
  const url = `${OPERATIONS_BASE}/coord/findings?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /coord/findings?finding_id=` (handler `get_coord_findings`) — one
 * finding by id, served past `expires_at` and outside any list filter.
 */
export async function fetchCoordFindingById(
  findingId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/findings?finding_id=${encodeURIComponent(findingId)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}
